package com.readlite.mobile;

import android.graphics.Bitmap;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;

/** Optional visual QA artifacts: pass -e captureScreenshots true to the test runner. */
final class UiPreviewCapture {
    static void save(String name) {
        if (!"true".equals(InstrumentationRegistry.getArguments().getString("captureScreenshots"))) return;
        android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        instrumentation.waitForIdleSync();
        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
        if (screenshot == null) throw new AssertionError("Cannot capture " + name);
        File directory = new File(instrumentation.getTargetContext().getExternalFilesDir(null), "ui-previews");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new AssertionError("Cannot create preview directory");
        try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".png"))) {
            screenshot.compress(Bitmap.CompressFormat.PNG, 100, output);
        } catch (java.io.IOException exception) {
            throw new AssertionError(exception);
        } finally {
            screenshot.recycle();
        }
    }
}
