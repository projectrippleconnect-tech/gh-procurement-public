package lk.generalhardware.procurement;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.Toast;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.EditText;
import android.view.inputmethod.InputMethodManager;
import android.text.InputType;
import android.widget.ProgressBar;
import android.widget.FrameLayout;
import android.view.ViewGroup;
import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.util.UUID;

/**
 * GH Procurement in a restricted WebView. The only privileged bridge action
 * transfers a manually generated supplier RFQ image and text to WhatsApp's UI.
 * It cannot press Send or guarantee WhatsApp honors the undocumented jid hint.
 */
public final class MainActivity extends Activity {
    private static final String SITE = "https://gh-procurement-production.up.railway.app";
    private static final int MAX_BASE64 = 8 * 1024 * 1024;
    private static final int FILE_REQUEST = 110;
    private WebView webView;
    private android.webkit.ValueCallback<Uri[]> pendingFiles;
    private ProgressBar progress;

    private static boolean isTrusted(String url) {
        try {
            Uri u = Uri.parse(url);
            return "https".equalsIgnoreCase(u.getScheme())
                && "gh-procurement-production.up.railway.app".equalsIgnoreCase(u.getHost())
                && (u.getPort() == -1 || u.getPort() == 443);
        } catch (Exception e) { return false; }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(0xffe9b92c));
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams bar = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 6);
        root.addView(progress, bar);
        // Diagnostic remains available without changing Railway's live website.
        // This lets the owner first test direct-recipient behavior with THEIR OWN number.
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        Button testShare = new Button(this);
        testShare.setText("TEST WHATSAPP (MY NUMBER)");
        testShare.setAllCaps(false);
        column.addView(testShare, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        column.addView(root, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        testShare.setOnClickListener(v -> runShareDiagnostic());
        setContentView(column);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.addJavascriptInterface(new SupplierShareBridge(), "GHProcurementAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value == 100 ? android.view.View.GONE : android.view.View.VISIBLE);
            }
            @Override public boolean onShowFileChooser(WebView view,
                    android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQUEST);
                    return true;
                } catch (Exception e) {
                    pendingFiles = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrusted(uri.toString())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Unable to open link", Toast.LENGTH_SHORT).show(); }
                return true;
            }
            @Override public void onReceivedError(WebView view,
                    android.webkit.WebResourceRequest req, android.webkit.WebResourceError err) {
                if (req.isForMainFrame())
                    Toast.makeText(MainActivity.this, "Could not load GH Procurement. Check your connection.", Toast.LENGTH_LONG).show();
            }
        });
        webView.loadUrl(SITE);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
        }
    }

    private int dp(int d) {
        return Math.round(d * getResources().getDisplayMetrics().density);
    }

    /** Uses a generated sample PNG to test normal WhatsApp without any RFQ or supplier data. */
    private void runShareDiagnostic() {
        EditText numberBox = new EditText(this);
        numberBox.setSingleLine(true);
        numberBox.setHint("Your own WhatsApp number, e.g. 0771234567");
        numberBox.setInputType(InputType.TYPE_CLASS_PHONE);
        numberBox.setPadding(dp(24), dp(12), dp(24), dp(12));
        new AlertDialog.Builder(this)
            .setTitle("Test direct WhatsApp sharing")
            .setMessage("Enter YOUR OWN WhatsApp number. The test will attempt to open that chat with a sample PNG and text. Do not send to a supplier.")
            .setView(numberBox)
            .setNegativeButton("Cancel", (d, w) -> {})
            .setPositiveButton("Prepare test", (d, w) -> {
                String phone = PhoneNumbers.normalize(numberBox.getText().toString());
                if (phone == null) {
                    Toast.makeText(this, "Enter a valid WhatsApp number", Toast.LENGTH_LONG).show();
                    return;
                }
                new Thread(() -> {
                    try {
                        Bitmap sample = Bitmap.createBitmap(900, 420, Bitmap.Config.ARGB_8888);
                        Canvas canvas = new Canvas(sample);
                        canvas.drawColor(Color.WHITE);
                        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
                        paint.setColor(Color.rgb(20, 36, 63));
                        paint.setTextSize(46f);
                        paint.setFakeBoldText(true);
                        canvas.drawText("GH PROCUREMENT", 60, 100, paint);
                        paint.setTextSize(34f);
                        canvas.drawText("WHATSAPP SHARE TEST", 60, 180, paint);
                        paint.setFakeBoldText(false);
                        paint.setTextSize(28f);
                        canvas.drawText("Sample image only - not an actual RFQ", 60, 270, paint);
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        if (!sample.compress(Bitmap.CompressFormat.PNG, 100, out))
                            throw new IllegalStateException("PNG generation failed");
                        sample.recycle();
                        String base64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                        prepareAndLaunch(phone,
                            "GH Procurement WhatsApp TEST - sample image and message. No supplier order.",
                            base64);
                    } catch (Exception e) {
                        runOnUiThread(() -> Toast.makeText(this, "Test preparation failed: " + e.getMessage(),
                            Toast.LENGTH_LONG).show());
                    }
                }).start();
            }).show();
    }

    final class SupplierShareBridge {
        /** Called from the trusted first-party RFQ action, not a background scheduler. */
        @JavascriptInterface public void shareRfqToSupplier(String phone, String text, String imageDataUrl, String supplier) {
            runOnUiThread(() -> {
                // Check current top-level URL at invocation time. Never expose this to arbitrary sites.
                if (!isTrusted(webView.getUrl())) {
                    Toast.makeText(MainActivity.this, "Blocked untrusted sharing page", Toast.LENGTH_LONG).show();
                    return;
                }
                String normalized = PhoneNumbers.normalize(phone);
                if (normalized == null || text == null || text.trim().isEmpty()
                        || text.length() > 12000 || imageDataUrl == null
                        || !imageDataUrl.startsWith("data:image/png;base64,")
                        || imageDataUrl.length() > MAX_BASE64) {
                    Toast.makeText(MainActivity.this, "Invalid RFQ image, text, or supplier number", Toast.LENGTH_LONG).show();
                    return;
                }
                final String number = normalized;
                final String caption = text;
                final String image = imageDataUrl.substring("data:image/png;base64,".length());
                // No additional in-app contact picker or confirmation: WhatsApp itself
                // still requires the user to verify the recipient and tap Send.
                new Thread(() -> prepareAndLaunch(number, caption, image)).start();
            });
        }
    }

    private void prepareAndLaunch(String number, String caption, String b64) {
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            if (bytes.length < 8 || bytes.length > 6 * 1024 * 1024
                || (bytes[0] & 255) != 137 || (bytes[1] & 255) != 80
                || (bytes[2] & 255) != 78 || (bytes[3] & 255) != 71)
                throw new IllegalArgumentException("Not a valid PNG");
            File dir = new File(getCacheDir(), "rfq-shares");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Cache unavailable");
            // Remove stale images but never overwrite a currently shared file.
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 86400000L) f.delete();
            String filename = "rfq-" + UUID.randomUUID() + ".png";
            File target = new File(dir, filename);
            try (FileOutputStream out = new FileOutputStream(target)) { out.write(bytes); }
            Uri uri = new Uri.Builder().scheme("content")
                .authority(getPackageName() + ".rfqprovider")
                .appendPath("rfq").appendPath(filename).build();
            runOnUiThread(() -> launchWhatsApp(number, caption, uri));
        } catch (Exception e) {
            runOnUiThread(() -> Toast.makeText(this, "Could not prepare the RFQ PNG: " + e.getMessage(),
                Toast.LENGTH_LONG).show());
        }
    }

    private void launchWhatsApp(String number, String caption, Uri uri) {
        // "jid" is an undocumented WhatsApp-specific hint; some builds ignore it.
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("image/png");
        send.setPackage("com.whatsapp");
        send.putExtra("jid", number + "@s.whatsapp.net");
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_TEXT, caption);
        send.setClipData(ClipData.newUri(getContentResolver(), "GH Procurement RFQ", uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(send);
        } catch (ActivityNotFoundException ex) {
            Toast.makeText(this, "Normal WhatsApp is not installed or cannot handle this RFQ share",
                Toast.LENGTH_LONG).show();
        } catch (Exception ex) {
            Toast.makeText(this, "WhatsApp could not open: " + ex.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (pendingFiles != null) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
        if (webView != null) { webView.removeJavascriptInterface("GHProcurementAndroid"); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
