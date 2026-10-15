package lk.generalhardware.procurement;

import org.junit.Test;
import static org.junit.Assert.*;

public class NativeContactShimTest {
    @Test public void scriptAddsContactPickerOnlyWhenAppBridgeExists() {
        String js = NativeContactShim.script();
        assertTrue(js.contains("GHProcurementAndroid.pickLocalPhoneContact"));
        assertTrue(js.contains("Object.defineProperty(navigator,'contacts'"));
        assertTrue(js.contains("if(!window.GHProcurementAndroid"));
        assertTrue(js.contains("getProperties:function()"));
        assertTrue(js.contains("name:[x.name||''],tel:[x.phone||'']"));
    }

    @Test public void selectedContactIsExplicitAndCancelledResultReleasesListener() {
        String js = NativeContactShim.script();
        assertTrue(js.contains("x.status==='selected'"));
        assertTrue(js.contains("e.name=x.status==='cancelled'?'AbortError'"));
        assertTrue(js.contains("removeEventListener('gh-procurement-native-contact'"));
        assertFalse(js.contains("readAllContacts"));
        assertFalse(js.contains("fetch("));
    }
}
