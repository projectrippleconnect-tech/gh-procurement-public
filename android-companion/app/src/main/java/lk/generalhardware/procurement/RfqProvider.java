package lk.generalhardware.procurement;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

/** Grants temporary read access to a single cached RFQ image, never general storage. */
public final class RfqProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "image/png"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) || uri.getPathSegments().size() != 2
            || !"rfq".equals(uri.getPathSegments().get(0))) throw new FileNotFoundException();
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("rfq-[a-f0-9-]{36}\\.png")) throw new FileNotFoundException();
        File parent = new File(getContext().getCacheDir(), "rfq-shares");
        File requested = new File(parent, name);
        try {
            if (!requested.getCanonicalFile().getParentFile().equals(parent.getCanonicalFile()))
                throw new FileNotFoundException();
        } catch (java.io.IOException e) { throw new FileNotFoundException(); }
        return ParcelFileDescriptor.open(requested, ParcelFileDescriptor.MODE_READ_ONLY);
    }
}
