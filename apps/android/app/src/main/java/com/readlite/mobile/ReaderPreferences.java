package com.readlite.mobile;

import android.content.Context;
import android.content.SharedPreferences;

public final class ReaderPreferences {
    private static final String PREFERENCES = "readlite_reader_preferences";
    private static final String KEY_FONT_SIZE = "font_size_sp";
    private static final int DEFAULT_FONT_SIZE = 18;
    private static final int MIN_FONT_SIZE = 14;
    private static final int MAX_FONT_SIZE = 32;

    private ReaderPreferences() {
    }

    public static int getFontSize(Context context) {
        return Math.max(
                MIN_FONT_SIZE,
                Math.min(
                        MAX_FONT_SIZE,
                        context.getApplicationContext()
                                .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                                .getInt(KEY_FONT_SIZE, DEFAULT_FONT_SIZE)
                )
        );
    }

    public static int adjustFontSize(Context context, int delta) {
        int size = Math.max(
                MIN_FONT_SIZE,
                Math.min(MAX_FONT_SIZE, getFontSize(context) + delta)
        );
        context.getApplicationContext()
                .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putInt(KEY_FONT_SIZE, size)
                .apply();
        return size;
    }
}
