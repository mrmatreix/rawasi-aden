package com.rawasiaden.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    // تم توجيه التطبيق ليفتح مسار تطبيق العميل (Client App) محلياً لسرعة فائقة
    // مع الإبقاء على ارتباطه بالسيرفر الحي لجلب البيانات عبر الـ API
    private static final String SERVER_URL = "file:///android_asset/public/client-app/index.html";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && url.startsWith("file:///")) {
                    // معالجة الروابط الداخلية لتطبيق العميل
                    if (url.contains("client-app/www/")) {
                        url = url.replace("client-app/www/", "client-app/");
                    }
                }
                view.loadUrl(url);
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                WebView newWebView = new WebView(MainActivity.this);
                newWebView.getSettings().setJavaScriptEnabled(true);
                newWebView.getSettings().setAllowFileAccessFromFileURLs(true);
                newWebView.getSettings().setAllowUniversalAccessFromFileURLs(true);
                
                newWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, String url) {
                        if (url != null && url.startsWith("file:///")) {
                            if (url.contains("client-app/www/")) {
                                url = url.replace("client-app/www/", "client-app/");
                            }
                        }
                        view.loadUrl(url);
                        return true;
                    }
                });
                newWebView.setWebChromeClient(this);
                
                setContentView(newWebView);
                
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(newWebView);
                resultMsg.sendToTarget();
                return true;
            }
        });

        webView.loadUrl(SERVER_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            setContentView(webView);
            super.onBackPressed();
        }
    }
}
