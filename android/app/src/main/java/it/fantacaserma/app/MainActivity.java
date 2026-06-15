package it.fantacaserma.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://darioschioppi.github.io/fantacaserma/";
    private WebView mWebView;

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
