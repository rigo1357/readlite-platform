package com.readlite.mobile;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public final class CatalogApiClient {
    private final String baseUrl;

    public CatalogApiClient() {
        baseUrl = BuildConfig.API_BASE_URL.replaceAll("/+$", "");
    }

    public static final class ApiException extends IOException {
        private final int statusCode;

        ApiException(int statusCode, String message) {
            super(message);
            this.statusCode = statusCode;
        }

        public int getStatusCode() {
            return statusCode;
        }
    }

    public JSONObject getGenres(String query) throws IOException, JSONException {
        Map<String, String> parameters = new LinkedHashMap<>();
        if (query != null && !query.trim().isEmpty()) {
            parameters.put("q", query.trim());
        }
        return get("/api/v1/genres", parameters);
    }

    public JSONObject getStories(
            String query,
            String genre,
            String sort,
            int page,
            int limit
    ) throws IOException, JSONException {
        return getStories(query, genre, sort, page, limit, "");
    }

    public JSONObject getStories(String query, String genre, String sort, int page, int limit, String lifecycle)
            throws IOException, JSONException {
        Map<String, String> parameters = new LinkedHashMap<>();
        if (query != null && !query.trim().isEmpty()) {
            parameters.put("q", query.trim());
        }
        if (genre != null && !genre.isEmpty()) {
            parameters.put("genre", genre);
        }
        parameters.put("sort", sort);
        parameters.put("page", String.valueOf(page));
        parameters.put("limit", String.valueOf(limit));
        if (lifecycle != null && !lifecycle.isEmpty()) parameters.put("lifecycle", lifecycle);
        return get("/api/v1/stories", parameters);
    }

    public JSONObject getStory(String storyId) throws IOException, JSONException {
        return get("/api/v1/stories/" + storyId, null);
    }

    public JSONObject getChapters(String storyId) throws IOException, JSONException {
        return get("/api/v1/stories/" + storyId + "/chapters", null);
    }

    public JSONObject getChapter(String storyId, String chapterId)
            throws IOException, JSONException {
        return get("/api/v1/stories/" + storyId + "/chapters/" + chapterId, null);
    }

    public JSONObject getCurrentUser() throws IOException, JSONException {
        return get("/api/v1/auth/me", null);
    }

    public JSONObject getLibrary() throws IOException, JSONException {
        return get("/api/v1/me/library", null);
    }

    public JSONObject updateProfile(String username, String displayName) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("username", username);
        body.put("displayName", displayName);
        return request("PATCH", "/api/v1/auth/me", body, true);
    }

    public JSONObject forgotPassword(String email) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("email", email);
        return request("POST", "/api/v1/auth/forgot-password", body, false);
    }

    public JSONObject resendVerification(String email) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("email", email);
        return request("POST", "/api/v1/auth/resend-verification", body, false);
    }

    public JSONObject resetPassword(String token, String password) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("token", token);
        body.put("password", password);
        return request("POST", "/api/v1/auth/reset-password", body, false);
    }

    public JSONObject changePassword(String currentPassword, String password) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("currentPassword", currentPassword);
        body.put("password", password);
        return request("POST", "/api/v1/auth/change-password", body, true);
    }

    public JSONObject getRecommendations() throws IOException, JSONException {
        return get("/api/v1/me/recommendations", java.util.Collections.singletonMap("limit", "10"));
    }

    public JSONObject getStoryFollow(String storyId) throws IOException, JSONException {
        return get("/api/v1/stories/" + storyId + "/follow", null);
    }

    public JSONObject setStoryFollow(String storyId, boolean following) throws IOException, JSONException {
        return request(following ? "PUT" : "DELETE", "/api/v1/stories/" + storyId + "/follow", null, true);
    }

    public JSONObject getFollowing(int page) throws IOException, JSONException {
        return get("/api/v1/me/following", java.util.Collections.singletonMap("page", String.valueOf(page)));
    }

    public JSONObject getNotifications(int page, boolean unread) throws IOException, JSONException {
        Map<String, String> parameters = new LinkedHashMap<>();
        parameters.put("page", String.valueOf(page));
        parameters.put("unread", String.valueOf(unread));
        return get("/api/v1/me/notifications", parameters);
    }

    public JSONObject getUnreadNotificationCount() throws IOException, JSONException {
        return get("/api/v1/me/notifications/unread-count", null);
    }

    public JSONObject readNotification(String id) throws IOException, JSONException {
        return request("PUT", "/api/v1/me/notifications/" + id + "/read", null, true);
    }

    public JSONObject readAllNotifications() throws IOException, JSONException {
        return request("PUT", "/api/v1/me/notifications/read-all", null, true);
    }

    public JSONObject getBookmarks(String storyId, int page) throws IOException, JSONException {
        return get("/api/v1/stories/" + storyId + "/bookmarks", java.util.Collections.singletonMap("page", String.valueOf(page)));
    }

    public JSONObject addBookmark(String storyId, String chapterId, int positionPermille, String note) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("chapterId", chapterId);
        body.put("positionPermille", positionPermille);
        body.put("note", note);
        return request("POST", "/api/v1/stories/" + storyId + "/bookmarks", body, true);
    }

    public JSONObject editBookmarkNote(String bookmarkId, String note) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("note", note);
        return request("PUT", "/api/v1/bookmarks/" + bookmarkId, body, true);
    }

    public JSONObject deleteBookmark(String bookmarkId) throws IOException, JSONException {
        return request("DELETE", "/api/v1/bookmarks/" + bookmarkId, null, true);
    }

    public JSONObject getComments(String storyId, String chapterId, String parentId, int page) throws IOException, JSONException {
        Map<String, String> parameters = new LinkedHashMap<>();
        parameters.put("page", String.valueOf(page));
        if (chapterId != null && !chapterId.isEmpty()) parameters.put("chapterId", chapterId);
        if (parentId != null && !parentId.isEmpty()) parameters.put("parentId", parentId);
        return get("/api/v1/stories/" + storyId + "/comments", parameters);
    }

    public JSONObject addComment(String storyId, String chapterId, String parentId, String content) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("content", content);
        if (chapterId != null && !chapterId.isEmpty()) body.put("chapterId", chapterId);
        if (parentId != null && !parentId.isEmpty()) body.put("parentId", parentId);
        return request("POST", "/api/v1/stories/" + storyId + "/comments", body, true);
    }

    public JSONObject editComment(String commentId, String content) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("content", content);
        return request("PUT", "/api/v1/comments/" + commentId, body, true);
    }

    public JSONObject deleteComment(String commentId) throws IOException, JSONException {
        return request("DELETE", "/api/v1/comments/" + commentId, null, true);
    }

    public JSONObject reportContent(String type, String id, String reason) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("targetType", type);
        body.put("targetId", id);
        body.put("reason", reason);
        return request("POST", "/api/v1/reports", body, true);
    }

    public JSONObject setFavorite(String storyId, boolean favorite)
            throws IOException, JSONException {
        return request(
                favorite ? "PUT" : "DELETE",
                "/api/v1/stories/" + storyId + "/favorite",
                null,
                true
        );
    }

    public JSONObject getReviews(String storyId, int page) throws IOException, JSONException {
        return get("/api/v1/stories/" + storyId + "/reviews", java.util.Collections.singletonMap("page", String.valueOf(page)));
    }

    public JSONObject getMyReview(String storyId) throws IOException, JSONException {
        return get("/api/v1/stories/" + storyId + "/reviews/me", null);
    }

    public JSONObject saveReview(String storyId, int rating, String content) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("rating", rating);
        body.put("content", content);
        return request("PUT", "/api/v1/stories/" + storyId + "/reviews/me", body, true);
    }

    public JSONObject deleteReview(String storyId) throws IOException, JSONException {
        return request("DELETE", "/api/v1/stories/" + storyId + "/reviews/me", null, true);
    }

    public JSONObject getReadingProgress(String storyId)
            throws IOException, JSONException {
        return get("/api/v1/stories/" + storyId + "/reading-progress", null);
    }

    public JSONObject saveReadingProgress(
            String storyId,
            String chapterId,
            int positionPermille
    ) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("chapterId", chapterId);
        body.put("positionPermille", positionPermille);
        return request(
                "PUT",
                "/api/v1/stories/" + storyId + "/reading-progress",
                body,
                true
        );
    }

    public void logout() throws IOException, JSONException {
        request("POST", "/api/v1/auth/logout", new JSONObject(), true);
    }

    private JSONObject get(String path, Map<String, String> parameters)
            throws IOException, JSONException {
        String address = CatalogUrlBuilder.build(baseUrl, path, parameters);
        return requestUrl("GET", address, null, false);
    }

    private JSONObject request(
            String method,
            String path,
            JSONObject body,
            boolean requiresCsrf
    ) throws IOException, JSONException {
        String address = CatalogUrlBuilder.build(baseUrl, path, null);
        return requestUrl(method, address, body, requiresCsrf);
    }

    private JSONObject requestUrl(
            String method,
            String address,
            JSONObject body,
            boolean requiresCsrf
    ) throws IOException, JSONException {
        String csrfToken = requiresCsrf ? readCsrfCookie() : null;
        if (requiresCsrf && (csrfToken == null || csrfToken.isEmpty())) {
            throw new ApiException(401, "Vui lòng đăng nhập để tiếp tục.");
        }

        HttpURLConnection connection =
                (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");

        if (requiresCsrf) {
            connection.setRequestProperty("x-csrf-token", csrfToken);
        }

        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty(
                    "Content-Type",
                    "application/json; charset=utf-8"
            );
            byte[] requestBytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(requestBytes);
            }
        }

        try {
            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400
                    ? connection.getErrorStream()
                    : connection.getInputStream();
            String responseBody = readResponseBody(stream);
            JSONObject json = responseBody.isEmpty()
                    ? new JSONObject()
                    : new JSONObject(responseBody);

            if (statusCode < 200 || statusCode >= 300) {
                JSONObject error = json.optJSONObject("error");
                String message = error == null ? "" : error.optString("message", "");
                if (message.isEmpty()) {
                    message = "Máy chủ ReadLite chưa thể xử lý yêu cầu.";
                }
                throw new ApiException(statusCode, message);
            }

            return json;
        } finally {
            connection.disconnect();
        }
    }

    private String readCsrfCookie() throws IOException {
        CookieManager manager = ReadLiteApplication.cookieManager();
        URI apiUri = URI.create(baseUrl + "/api/v1");
        for (HttpCookie cookie : manager.getCookieStore().get(apiUri)) {
            if ("readlite_csrf".equals(cookie.getName()) && !cookie.hasExpired()) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private static String readResponseBody(InputStream input) throws IOException {
        if (input == null) {
            return "";
        }

        StringBuilder responseBody = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(input, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                responseBody.append(line);
            }
        }
        return responseBody.toString();
    }
}
