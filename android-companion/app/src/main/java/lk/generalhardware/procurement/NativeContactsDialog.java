package lk.generalhardware.procurement;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.ContactsContract;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A genuine native contact search, independent of Chromium's broken Contact Picker.
 * The user grants READ_CONTACTS to this APK and explicitly chooses ONE phone number.
 * All candidate rows stay inside the Android process: no bulk upload or JS bridge
 * exposure. Only the chosen name and phone are sent back to the first-party page.
 */
final class NativeContactsDialog {
    interface Callback {
        void onPicked(String name, String phone);
        void onClosed(String reason);
    }

    static final class Entry {
        final String name;
        final String phone;
        Entry(String name, String phone) { this.name = name; this.phone = phone; }
        String label() { return name + "\n" + phone; }
    }

    private final Activity activity;
    private final Callback callback;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final List<Entry> visible = new ArrayList<>();
    private final ArrayAdapter<String> adapter;
    private AlertDialog dialog;
    private TextView status;
    private Runnable pendingSearch;
    private int queryEpoch;
    private boolean closed;
    private boolean picked;

    NativeContactsDialog(Activity activity, Callback callback) {
        this.activity = activity;
        this.callback = callback;
        adapter = new ArrayAdapter<String>(activity, android.R.layout.simple_list_item_1, new ArrayList<>()) {
            @Override public View getView(int position, View convertView, android.view.ViewGroup parent) {
                View view = super.getView(position, convertView, parent);
                if (view instanceof TextView) {
                    TextView t = (TextView) view;
                    t.setSingleLine(false);
                    t.setMaxLines(2);
                    t.setPadding(dp(18), dp(9), dp(18), dp(9));
                }
                return view;
            }
        };
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    void show() {
        if (activity.checkSelfPermission(Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
            callback.onClosed("permission_denied");
            worker.shutdownNow();
            return;
        }
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16), dp(8), dp(16), dp(8));

        EditText search = new EditText(activity);
        search.setSingleLine(true);
        search.setHint("Search contacts by name or phone...");
        search.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        content.addView(search, new LinearLayout.LayoutParams(-1, dp(56)));

        status = new TextView(activity);
        status.setText("Loading phone contacts...");
        status.setPadding(dp(4), dp(8), dp(4), dp(8));
        content.addView(status, new LinearLayout.LayoutParams(-1, -2));

        ListView choices = new ListView(activity);
        choices.setAdapter(adapter);
        choices.setFastScrollEnabled(true);
        content.addView(choices, new LinearLayout.LayoutParams(-1, dp(340)));
        choices.setOnItemClickListener((parent, view, position, id) -> {
            if (closed || position < 0 || position >= visible.size()) return;
            Entry item = visible.get(position);
            // The single user-selected entry, and only this entry, crosses into WebView.
            picked = true;
            callback.onPicked(item.name, item.phone);
            dialog.dismiss();
        });

        dialog = new AlertDialog.Builder(activity)
            .setTitle("Select supplier from phone")
            .setView(content)
            .setNegativeButton("Cancel", (d, which) -> {})
            .setOnDismissListener(d -> close())
            .create();
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                scheduleSearch(s.toString());
            }
            @Override public void afterTextChanged(Editable s) {}
        });
        dialog.show();
        scheduleSearch("");
    }

    private void scheduleSearch(String term) {
        if (closed) return;
        if (pendingSearch != null) main.removeCallbacks(pendingSearch);
        pendingSearch = () -> load(term);
        main.postDelayed(pendingSearch, 150);
    }

    private void load(String search) {
        if (closed) return;
        final int myEpoch = ++queryEpoch;
        status.setText("Searching phone contacts...");
        worker.execute(() -> {
            final List<Entry> found = new ArrayList<>();
            String problem = null;
            final String[] projection = {
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            };
            final String needle = search.trim();
            final String where = needle.isEmpty() ? null :
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY + " LIKE ? OR " +
                ContactsContract.CommonDataKinds.Phone.NUMBER + " LIKE ?";
            final String[] args = needle.isEmpty() ? null :
                new String[]{"%" + needle + "%", "%" + needle + "%"};
            try (Cursor cursor = activity.getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                where,
                args,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY + " COLLATE NOCASE ASC")) {
                if (cursor == null) problem = "Phone contacts are unavailable on this device.";
                else {
                    final int n = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY);
                    final int p = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER);
                    while (!Thread.currentThread().isInterrupted() && cursor.moveToNext() && found.size() < 80) {
                        String name = cursor.getString(n);
                        String number = cursor.getString(p);
                        if (number == null || number.trim().isEmpty()) continue;
                        if (name == null || name.trim().isEmpty()) name = number;
                        found.add(new Entry(name.trim(), number.trim()));
                    }
                }
            } catch (SecurityException e) {
                problem = "Contacts permission is unavailable. Allow it in Android App Settings.";
            } catch (Exception e) {
                problem = "Could not search device contacts. Try reopening the app.";
            }
            final String error = problem;
            main.post(() -> {
                if (closed || myEpoch != queryEpoch) return;
                visible.clear();
                visible.addAll(found);
                adapter.clear();
                for (Entry entry : visible) adapter.add(entry.label());
                adapter.notifyDataSetChanged();
                status.setText(error != null ? error :
                    visible.isEmpty() ? "No matching phone contacts. Check the Contacts app." :
                    (visible.size() == 80 ? "Showing first 80 matches. Type to narrow results." :
                        visible.size() + " phone numbers found. Tap one to use it."));
            });
        });
    }

    private void close() {
        if (closed) return;
        closed = true;
        queryEpoch++;
        if (pendingSearch != null) main.removeCallbacks(pendingSearch);
        worker.shutdownNow();
        if (!picked) callback.onClosed("cancelled");
    }

    void dismiss() {
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        else close();
    }
}
