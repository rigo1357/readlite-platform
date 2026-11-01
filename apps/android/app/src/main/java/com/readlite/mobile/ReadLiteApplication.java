package com.readlite.mobile;

import android.app.Application;

import java.net.CookieHandler;
import java.net.CookieManager;
import java.net.CookiePolicy;

public final class ReadLiteApplication extends Application {
    private static CookieManager cookieManager;

    @Override
    public void onCreate() {
        super.onCreate();
        synchronized (ReadLiteApplication.class) {
            if (cookieManager == null) {
                cookieManager = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
            }
            CookieHandler.setDefault(cookieManager);
        }
        ThemeManager.applySavedTheme(this);
    }

    public static CookieManager cookieManager() {
        synchronized (ReadLiteApplication.class) {
            if (cookieManager == null) {
                cookieManager = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
            }
            return cookieManager;
        }
    }
}

