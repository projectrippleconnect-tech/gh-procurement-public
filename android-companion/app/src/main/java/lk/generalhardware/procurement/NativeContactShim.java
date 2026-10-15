package lk.generalhardware.procurement;

/**
 * A compatibility adapter for the already-live GH Procurement website:
 * navigator.contacts.select(['name','tel']) in the trusted Android WebView
 * delegates to our in-app permission-gated native contact search.
 *
 * Only one explicitly tapped phone contact is returned; no bulk list enters JS.
 * Runs only after MainActivity confirms the top-level website is trusted.
 */
final class NativeContactShim {
    private NativeContactShim() {}

    static String script() {
        return "(function(){"
            + "if(window.__ghNativeContactsReady)return;"
            + "if(!window.GHProcurementAndroid||typeof GHProcurementAndroid.pickLocalPhoneContact!=='function')return;"
            + "var nativeApi={getProperties:function(){return Promise.resolve(['name','tel']);},"
            + "select:function(){return new Promise(function(resolve,reject){"
            + "var id='ghc_'+Math.random().toString(36).slice(2)+Date.now().toString(36);"
            + "var timer;"
            + "function cleanup(){clearTimeout(timer);window.removeEventListener('gh-procurement-native-contact',reply);}"
            + "function reply(ev){var x=ev&&ev.detail;if(!x||x.requestId!==id)return;cleanup();"
            + "if(x.status==='selected')resolve([{name:[x.name||''],tel:[x.phone||'']}]);"
            + "else {var e=new Error(x.status==='permission_denied'?'Allow Contacts access for GH Procurement Android app.':'No phone contact selected.');"
            + "e.name=x.status==='cancelled'?'AbortError':x.status==='permission_denied'?'NotAllowedError':'NotFoundError';reject(e);}}"
            + "window.addEventListener('gh-procurement-native-contact',reply);"
            + "timer=setTimeout(function(){cleanup();reject(new Error('Native contacts timed out'));},300000);"
            + "try{GHProcurementAndroid.pickLocalPhoneContact(id);}catch(e){cleanup();reject(e);}"
            + "});}};"
            + "try{Object.defineProperty(navigator,'contacts',{configurable:true,value:nativeApi});"
            + "window.__ghNativeContactsReady=true;}"
            + "catch(e){try{navigator.contacts=nativeApi;window.__ghNativeContactsReady=true;}catch(ignore){}}"
            + "})();";
    }
}
