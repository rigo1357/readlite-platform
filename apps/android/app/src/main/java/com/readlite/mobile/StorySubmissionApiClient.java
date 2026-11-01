package com.readlite.mobile;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpCookie;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Session-aware endpoints for author EPUB submissions and the admin review queue. */
public final class StorySubmissionApiClient {
    public interface UploadProgressListener {
        void onProgress(long bytesSent, long totalBytes);
    }

    private static final long MAX_EPUB_BYTES = 100L * 1024L * 1024L;
    private static final long MAX_COVER_BYTES = 10L * 1024L * 1024L;
    private final String baseUrl;
    private volatile HttpURLConnection activeUpload;

    public StorySubmissionApiClient() {
        baseUrl = BuildConfig.API_BASE_URL.replaceAll("/+$", "");
    }

    public JSONObject currentUser() throws IOException, JSONException {
        return request("GET", "/api/v1/auth/me", null, false);
    }

    public JSONObject listMyStories(String status) throws IOException, JSONException {
        return request("GET", "/api/v1/author/stories?status=" + status, null, false);
    }

    public JSONObject getAuthorStory(String storyId) throws IOException, JSONException {
        return request("GET", "/api/v1/author/stories/" + storyId, null, false);
    }

    public JSONObject updateStory(String storyId, JSONObject changes)
            throws IOException, JSONException {
        return request("POST", "/api/v1/author/stories/" + storyId + "/metadata", changes, true);
    }

    public JSONObject submitStory(String storyId) throws IOException, JSONException {
        return request("POST", "/api/v1/author/stories/" + storyId + "/submit", new JSONObject(), true);
    }

    public JSONObject listAdminQueue() throws IOException, JSONException {
        return request("GET", "/api/v1/admin/story-submissions", null, false);
    }

    public JSONObject listContentUpdates(String storyId, int page) throws IOException, JSONException {
        return request("GET", "/api/v1/author/stories/" + storyId + "/updates?page=" + page, null, false);
    }

    public JSONObject getContentUpdate(String id) throws IOException, JSONException {
        return request("GET", "/api/v1/author/content-updates/" + id, null, false);
    }

    public JSONObject createContentUpdate(String storyId, JSONObject body) throws IOException, JSONException {
        return request("POST", "/api/v1/author/stories/" + storyId + "/updates", body, true);
    }

    public JSONObject saveContentUpdate(String id, JSONObject body) throws IOException, JSONException {
        return request("PUT", "/api/v1/author/content-updates/" + id, body, true);
    }

    public JSONObject submitContentUpdate(String id, boolean cancel) throws IOException, JSONException {
        return request("POST", "/api/v1/author/content-updates/" + id + (cancel ? "/cancel" : "/submit"), new JSONObject(), true);
    }

    public JSONObject importContentUpdate(Context context, Uri uri, String storyId, UploadProgressListener listener)
            throws IOException, JSONException {
        return upload(context, uri, "/api/v1/author/stories/" + storyId + "/updates/import-epub", "application/epub+zip", MAX_EPUB_BYTES, "update.epub", listener);
    }

    public JSONObject getAdminStory(String storyId) throws IOException, JSONException {
        return request("GET", "/api/v1/admin/story-submissions/" + storyId, null, false);
    }

    public JSONObject decide(String storyId, String decision, String reason)
            throws IOException, JSONException {
        JSONObject body = new JSONObject().put("decision", decision);
        if (reason != null && !reason.trim().isEmpty()) {
            body.put("reason", reason.trim());
        }
        return request("POST", "/api/v1/admin/story-submissions/" + storyId + "/decision", body, true);
    }

    public JSONObject importEpub(Context context, Uri uri, UploadProgressListener listener)
            throws IOException, JSONException {
        return upload(context, uri, "/api/v1/author/stories/import-epub", "application/epub+zip",
                MAX_EPUB_BYTES, "story.epub", listener);
    }

    public JSONObject uploadCover(Context context, Uri uri, String storyId,
                                  UploadProgressListener listener)
            throws IOException, JSONException {
        String mimeType = context.getContentResolver().getType(uri);
        if (!isAllowedCoverType(mimeType)) {
            throw new IOException("Chỉ hỗ trợ ảnh bìa JPEG, PNG hoặc WebP.");
        }
        return upload(context, uri, "/api/v1/author/stories/" + storyId + "/cover", mimeType,
                MAX_COVER_BYTES, coverFallbackFilename(mimeType), listener);
    }

    public void cancelActiveUpload() {
        HttpURLConnection connection = activeUpload;
        if (connection != null) {
            connection.disconnect();
        }
    }

    static boolean isAllowedCoverType(String mimeType) {
        if (mimeType == null) return false;
        return "image/jpeg".equalsIgnoreCase(mimeType)
                || "image/png".equalsIgnoreCase(mimeType)
                || "image/webp".equalsIgnoreCase(mimeType);
    }

    static String coverFallbackFilename(String mimeType) {
        if ("image/png".equalsIgnoreCase(mimeType)) return "cover.png";
        if ("image/webp".equalsIgnoreCase(mimeType)) return "cover.webp";
        return "cover.jpg";
    }

    static String safeUploadFilename(String value, String fallback) {
        String safe = value == null ? "" : value.replaceAll("[\\r\\n\\\"\\\\/\\p{Cntrl}]", "_").trim();
        if (safe.replaceAll("[._-]", "").isEmpty()) safe = fallback;
        if (safe.length() > 120) safe = safe.substring(safe.length() - 120);
        return safe;
    }

    private JSONObject upload(Context context, Uri uri, String path, String mimeType,
                              long maxBytes, String fallbackFilename,
                              UploadProgressListener listener)
            throws IOException, JSONException {
        currentUser(); // Refresh an expired session before streaming a document.
        String boundary = "ReadLite-" + UUID.randomUUID();
        String csrf = csrfToken();
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        activeUpload = connection;
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(path.contains("/updates/import-epub") ? 120_000 : 30_000);
        connection.setUseCaches(false);
        connection.setDoOutput(true);
        connection.setChunkedStreamingMode(64 * 1024);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        connection.setRequestProperty("x-csrf-token", csrf);

        String filename = safeUploadFilename(displayName(context, uri), fallbackFilename);
        long totalBytes = contentLength(context, uri);
        if (totalBytes > maxBytes) {
            connection.disconnect();
            activeUpload = null;
            throw new IOException("Tệp vượt quá giới hạn cho phép.");
        }
        String prefix = "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\n"
                + "Content-Type: " + mimeType + "\r\n\r\n";
        long sent = 0;
        try (InputStream input = context.getContentResolver().openInputStream(uri);
             OutputStream output = connection.getOutputStream()) {
            if (input == null) throw new IOException("Không mở được tệp đã chọn.");
            output.write(prefix.getBytes(StandardCharsets.UTF_8));
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Đã hủy tải tệp.");
                sent += count;
                if (sent > maxBytes) throw new IOException("Tệp vượt quá giới hạn cho phép.");
                output.write(buffer, 0, count);
                if (listener != null) listener.onProgress(sent, totalBytes);
            }
            output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            output.flush();
            return readJsonResponse(connection);
        } finally {
            activeUpload = null;
            connection.disconnect();
        }
    }

    private JSONObject request(String method, String path, JSONObject body, boolean csrf)
            throws IOException, JSONException {
        return request(method, path, body, csrf, true);
    }

    private JSONObject request(String method, String path, JSONObject body, boolean csrf, boolean retry)
            throws IOException, JSONException {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(20_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        if (csrf) connection.setRequestProperty("x-csrf-token", csrfToken());
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
        }
        try {
            return readJsonResponse(connection);
        } catch (CatalogApiClient.ApiException exception) {
            if (exception.getStatusCode() == 401 && retry && !path.equals("/api/v1/auth/refresh")) {
                request("POST", "/api/v1/auth/refresh", new JSONObject(), true, false);
                return request(method, path, body, csrf, false);
            }
            throw exception;
        } finally {
            connection.disconnect();
        }
    }

    private JSONObject readJsonResponse(HttpURLConnection connection)
            throws IOException, JSONException {
        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        StringBuilder text = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) text.append(line);
            }
        }
        JSONObject response = text.length() == 0 ? new JSONObject() : new JSONObject(text.toString());
        if (status < 200 || status >= 300) {
            JSONObject error = response.optJSONObject("error");
            String message = error == null ? "" : error.optString("message", "");
            if (message.isEmpty()) message = "Máy chủ ReadLite chưa thể xử lý yêu cầu.";
            throw new CatalogApiClient.ApiException(status, message);
        }
        return response;
    }

    private String csrfToken() throws IOException {
        URI apiUri = URI.create(baseUrl + "/api/v1");
        for (HttpCookie cookie : ReadLiteApplication.cookieManager().getCookieStore().get(apiUri)) {
            if ("readlite_csrf".equals(cookie.getName()) && !cookie.hasExpired()) return cookie.getValue();
        }
        throw new CatalogApiClient.ApiException(401, "Vui lòng đăng nhập để tiếp tục.");
    }

    private static String displayName(Context context, Uri uri) {
        try (Cursor cursor = context.getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (RuntimeException ignored) {
            // Use a generated safe fallback if the document provider has no display name.
        }
        return "";
    }

    private static long contentLength(Context context, Uri uri) {
        try (Cursor cursor = context.getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index);
            }
        } catch (RuntimeException ignored) {
            // The upload loop enforces the limit when length metadata is unavailable.
        }
        return -1;
    }
}
