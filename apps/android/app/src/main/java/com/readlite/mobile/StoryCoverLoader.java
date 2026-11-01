package com.readlite.mobile;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.DisplayMetrics;
import android.util.LruCache;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class StoryCoverLoader {
    private static final int MAX_COVER_BYTES = 10 * 1024 * 1024;
    private static final long MAX_DECODE_PIXELS = 24_000_000L;
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(3);
    private static final LruCache<String, Bitmap> CACHE = new LruCache<>(cacheCapacity()) {
        @Override
        protected int sizeOf(String key, Bitmap value) {
            return Math.max(1, value.getByteCount());
        }
    };

    private StoryCoverLoader() {
    }

    public static void bind(
            String coverUrl,
            String title,
            ImageView imageView,
            TextView placeholder
    ) {
        bind(coverUrl, title, imageView, placeholder, 80, 120);
    }

    public static void bind(
            String coverUrl,
            String title,
            ImageView imageView,
            TextView placeholder,
            int targetWidthDp,
            int targetHeightDp
    ) {
        String resolvedUrl = StoryCoverUrlPolicy.resolve(BuildConfig.API_BASE_URL, coverUrl);
        imageView.setTag(resolvedUrl);
        imageView.setImageDrawable(null);
        imageView.setVisibility(View.GONE);
        imageView.setContentDescription(imageView.getContext().getString(
                R.string.story_cover_content_description,
                title == null ? "" : title
        ));
        String safeTitle = title == null || title.trim().isEmpty()
                ? imageView.getContext().getString(R.string.story_cover_missing)
                : title.trim();
        placeholder.setText(safeTitle);
        placeholder.setVisibility(View.VISIBLE);

        if (resolvedUrl == null) {
            return;
        }

        Bitmap cached = CACHE.get(resolvedUrl);
        if (cached != null) {
            showCover(resolvedUrl, cached, imageView, placeholder);
            return;
        }

        int targetWidth = targetPixels(imageView.getResources().getDisplayMetrics(), targetWidthDp);
        int targetHeight = targetPixels(imageView.getResources().getDisplayMetrics(), targetHeightDp);
        EXECUTOR.execute(() -> {
            Bitmap bitmap = download(resolvedUrl, targetWidth, targetHeight);
            if (bitmap != null) {
                CACHE.put(resolvedUrl, bitmap);
            }
            imageView.post(() -> showCover(resolvedUrl, bitmap, imageView, placeholder));
        });
    }

    private static void showCover(
            String resolvedUrl,
            Bitmap bitmap,
            ImageView imageView,
            TextView placeholder
    ) {
        if (!resolvedUrl.equals(imageView.getTag())) {
            return;
        }
        if (bitmap == null) {
            imageView.setImageDrawable(null);
            imageView.setVisibility(View.GONE);
            placeholder.setVisibility(View.VISIBLE);
            return;
        }
        imageView.setImageBitmap(bitmap);
        imageView.setVisibility(View.VISIBLE);
        placeholder.setVisibility(View.GONE);
    }

    private static Bitmap download(String address, int targetWidth, int targetHeight) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(address).openConnection();
            connection.setConnectTimeout(6_000);
            connection.setReadTimeout(8_000);
            connection.setUseCaches(true);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "image/jpeg,image/png,image/webp");
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK
                    || !isAllowedMimeType(connection.getContentType())) {
                return null;
            }
            long contentLength = connection.getContentLengthLong();
            if (contentLength > MAX_COVER_BYTES) {
                return null;
            }
            try (InputStream input = connection.getInputStream()) {
                byte[] bytes = readBounded(input);
                return bytes == null ? null : decode(bytes, targetWidth, targetHeight);
            }
        } catch (IOException | RuntimeException ignored) {
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static boolean isAllowedMimeType(String contentType) {
        if (contentType == null) {
            return false;
        }
        String mimeType = contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return "image/jpeg".equals(mimeType)
                || "image/jpg".equals(mimeType)
                || "image/png".equals(mimeType)
                || "image/webp".equals(mimeType);
    }

    private static byte[] readBounded(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(16 * 1024);
        byte[] buffer = new byte[8 * 1024];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > MAX_COVER_BYTES) {
                return null;
            }
            output.write(buffer, 0, count);
        }
        return total == 0 ? null : output.toByteArray();
    }

    private static Bitmap decode(byte[] bytes, int targetWidth, int targetHeight) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return null;
        }

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, targetWidth, targetHeight);
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    private static int sampleSize(int width, int height, int targetWidth, int targetHeight) {
        int sample = 1;
        while ((width / sample > targetWidth * 2 || height / sample > targetHeight * 2
                || ((long) width * height) / ((long) sample * sample) > MAX_DECODE_PIXELS)
                && sample <= (1 << 14)) {
            sample *= 2;
        }
        return sample;
    }

    private static int targetPixels(DisplayMetrics metrics, int dp) {
        return Math.max(1, Math.round(dp * metrics.density));
    }

    private static int cacheCapacity() {
        long recommended = Runtime.getRuntime().maxMemory() / 8L;
        return (int) Math.min(Integer.MAX_VALUE, Math.max(2L * 1024 * 1024, recommended));
    }
}
