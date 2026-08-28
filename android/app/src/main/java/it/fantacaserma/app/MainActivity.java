package it.fantacaserma.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://darioschioppi.github.io/fantacaserma/";
    private WebView mWebView;

    /**
     * Ponte JS→Android per salvare file (es. export Excel rose) direttamente
     * nella cartella Download del dispositivo. Necessario perché dentro questa
     * WebView nativa (non un browser vero) né il trucco <a download> né la Web
     * Share API garantiscono un salvataggio reale: entrambi possono "eseguire"
     * senza errori JS ma senza scrivere alcun file sul filesystem — bug
     * segnalato: "l'export in excel non salva fisicamente il file nel device".
     * Scrivendo il file da codice nativo Android, il salvataggio è garantito.
     */
    public class AndroidFileSaver {
        @JavascriptInterface
        public void saveFile(String base64Data, String filename, String mimeType) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android 10+: scoped storage via MediaStore, nessun permesso runtime richiesto.
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new java.io.IOException("insert MediaStore fallito");
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out == null) throw new java.io.IOException("openOutputStream fallito");
                        out.write(bytes);
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, values, null, null);
                } else {
                    // Android < 10: scrittura diretta nella cartella pubblica Download
                    // (richiede WRITE_EXTERNAL_STORAGE, dichiarato nel Manifest).
                    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!dir.exists()) dir.mkdirs();
                    File file = new File(dir, filename);
                    try (FileOutputStream out = new FileOutputStream(file)) {
                        out.write(bytes);
                    }
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Salvato in Download: " + filename, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                android.util.Log.e("FantaCaserma", "Errore salvataggio file: " + e.getMessage(), e);
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Errore salvataggio file: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Status/navigation bar color matching app theme
        getWindow().setStatusBarColor(Color.parseColor("#0a0f1e"));
        getWindow().setNavigationBarColor(Color.parseColor("#0a0f1e"));

        mWebView = new WebView(this);
        mWebView.setBackgroundColor(Color.parseColor("#0a0f1e"));
        setContentView(mWebView);

        WebSettings settings = mWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);       // localStorage (Firebase auth)
        settings.setDatabaseEnabled(true);          // WebSQL compat
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE); // sempre versione aggiornata

        // Espone AndroidFileSaver.saveFile(base64, filename, mimeType) al JS della
        // pagina: index.html lo rileva (typeof AndroidFileSaver !== 'undefined')
        // e lo usa al posto del download/Web Share quando gira dentro questa app.
        mWebView.addJavascriptInterface(new AndroidFileSaver(), "AndroidFileSaver");

        // Keep all navigation inside the WebView (no external browser)
        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });

        // Forward JS console messages to Android logcat (debug)
        mWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                android.util.Log.d("FantaCaserma",
                        cm.message() + " [" + cm.sourceId() + ":" + cm.lineNumber() + "]");
                return true;
            }
        });

        if (savedInstanceState != null) {
            mWebView.restoreState(savedInstanceState);
        } else {
            mWebView.clearCache(true); // svuota cache ad ogni avvio per contenuto fresco
            mWebView.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (mWebView != null) {
            mWebView.saveState(outState);
        }
    }

    @Override
    public void onBackPressed() {
        if (mWebView != null && mWebView.canGoBack()) {
            mWebView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
