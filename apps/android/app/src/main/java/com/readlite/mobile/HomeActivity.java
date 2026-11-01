package com.readlite.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Home shelves combine the catalog with recommendations from the reader's actual library. */
public final class HomeActivity extends AppCompatActivity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService notificationExecutor = Executors.newSingleThreadExecutor();
    private final CatalogApiClient api = new CatalogApiClient();
    private final Set<String> updatingFavorites = new HashSet<>();
    private TextView status;
    private boolean loading;
    private boolean notificationLoading;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_home);
        SystemBarInsets.apply(findViewById(R.id.home_root));
        status = findViewById(R.id.home_status);
        PrimaryNavigation.bind(this, R.id.home_bottom_navigation, R.id.catalog_nav_home);
        findViewById(R.id.home_account).setOnClickListener(v -> open(AccountActivity.class));
        findViewById(R.id.home_notifications).setOnClickListener(v -> open(ReaderUpdatesActivity.class));
        findViewById(R.id.home_explore).setOnClickListener(v -> open(CatalogActivity.class));
        findViewById(R.id.home_library_summary).setOnClickListener(v -> open(BookshelfActivity.class));
        findViewById(R.id.home_retry).setOnClickListener(v -> loadHome());
        findViewById(R.id.home_recommendations_retry).setOnClickListener(v -> loadHome());
    }

    @Override protected void onResume() {
        super.onResume();
        loadHome();
        loadUnreadCount();
    }

    private void loadUnreadCount() {
        if (notificationLoading) return;
        notificationLoading = true;
        notificationExecutor.execute(() -> {
            int count = -1;
            try { count = api.getUnreadNotificationCount().optInt("unreadCount"); }
            catch (Exception ignored) { /* Public shelves remain independent of account updates. */ }
            int savedCount = count;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                notificationLoading = false;
                MaterialButton button = findViewById(R.id.home_notifications);
                button.setText(savedCount > 0 ? "Thông báo (" + (savedCount > 99 ? "99+" : savedCount) + ")" : "Thông báo");
                button.setContentDescription(savedCount >= 0 ? savedCount + " thông báo chưa đọc" : "Mở thông báo");
            });
        });
    }

    private void open(Class<?> destination) {
        Intent intent = new Intent(this, destination);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
    }

    private void loadHome() {
        if (loading) return;
        loading = true;
        status.setText("Đang tải truyện…");
        status.setVisibility(View.VISIBLE);
        findViewById(R.id.home_retry).setVisibility(View.GONE);
        ((TextView) findViewById(R.id.home_recommendations_status)).setText("Đang chọn truyện cho bạn…");
        findViewById(R.id.home_recommendations_retry).setVisibility(View.GONE);
        executor.execute(() -> {
            String name = "Bạn đọc ReadLite";
            String librarySummary = "Mở tủ sách của bạn     ›";
            Set<String> favorites = new HashSet<>();
            try {
                JSONObject user = api.getCurrentUser().optJSONObject("user");
                if (user != null) name = user.optString("displayName", name);
                JSONArray library = api.getLibrary().optJSONArray("stories");
                int reading = 0;
                if (library != null) {
                    for (int i = 0; i < library.length(); i++) {
                        JSONObject story = library.optJSONObject(i);
                        if (story == null) continue;
                        if (story.optBoolean("isFavorite")) favorites.add(story.optString("id"));
                        if (story.optJSONObject("readingProgress") != null) reading++;
                    }
                    librarySummary = reading + " đang đọc   ·   " + favorites.size() + " yêu thích     ›";
                }
            } catch (Exception ignored) {
                // Public shelves remain available if the session or library cannot be loaded.
            }
            final String greeting = name;
            final String summary = librarySummary;
            JSONArray newestResult = null;
            JSONArray popularResult = null;
            try { newestResult = api.getStories(null, null, "newest", 1, 8).optJSONArray("stories"); }
            catch (Exception ignored) { /* Other shelves can still load independently. */ }
            try { popularResult = api.getStories(null, null, "most_read", 1, 8).optJSONArray("stories"); }
            catch (Exception ignored) { /* Do not discard a successfully loaded newest shelf. */ }
            final JSONArray newest = newestResult;
            final JSONArray popular = popularResult;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                ((TextView) findViewById(R.id.home_greeting)).setText(greeting);
                ((MaterialButton) findViewById(R.id.home_library_summary)).setText(summary);
                if (newest != null) renderShelf(R.id.home_newest_shelf, newest, favorites, false);
                if (popular != null) renderShelf(R.id.home_popular_shelf, popular, favorites, false);
                boolean failed = newest == null || popular == null;
                boolean empty = !failed && newest.length() == 0 && popular.length() == 0;
                status.setText(failed ? getString(R.string.catalog_connection_error)
                        : empty ? "Chưa có truyện được xuất bản. Hãy quay lại sau nhé." : "");
                status.setVisibility(failed || empty ? View.VISIBLE : View.GONE);
                findViewById(R.id.home_retry).setVisibility(failed ? View.VISIBLE : View.GONE);
            });
            // Recommendations have their own error state, so a private-session or
            // recommendation outage never hides the public catalog shelves above.
            try {
                JSONObject response = api.getRecommendations();
                JSONArray recommendations = response.optJSONArray("stories");
                boolean personalized = response.optBoolean("personalized", false);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    loading = false;
                    boolean hasStories = recommendations != null && recommendations.length() > 0;
                    renderShelf(R.id.home_recommendations_shelf, recommendations, favorites, true);
                    findViewById(R.id.home_recommendations_scroll).setVisibility(hasStories ? View.VISIBLE : View.GONE);
                    ((TextView) findViewById(R.id.home_recommendations_status)).setText(!hasStories
                            ? "Bạn đã khám phá hết gợi ý hiện có. Hãy xem thêm truyện mới bên dưới."
                            : personalized ? "Dựa trên thể loại của truyện bạn yêu thích và đã đọc."
                            : "Khám phá truyện trong danh mục. Đọc hoặc yêu thích để có gợi ý theo sở thích.");
                });
            } catch (Exception exception) {
                boolean signIn = exception instanceof CatalogApiClient.ApiException
                        && ((CatalogApiClient.ApiException) exception).getStatusCode() == 401;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    loading = false;
                    renderShelf(R.id.home_recommendations_shelf, null, favorites, true);
                    findViewById(R.id.home_recommendations_scroll).setVisibility(View.GONE);
                    ((TextView) findViewById(R.id.home_recommendations_status)).setText(signIn
                            ? "Đăng nhập để nhận gợi ý từ truyện bạn yêu thích và đã đọc."
                            : "Chưa tải được gợi ý. Bạn vẫn có thể khám phá các truyện bên dưới.");
                    findViewById(R.id.home_recommendations_retry).setVisibility(signIn ? View.GONE : View.VISIBLE);
                });
            }
        });
    }

    private void renderShelf(int containerId, JSONArray rows, Set<String> favorites, boolean showReason) {
        LinearLayout container = findViewById(containerId);
        container.removeAllViews();
        ArrayList<StoryCardAdapter.StoryItem> stories = new ArrayList<>();
        if (rows != null) for (int i = 0; i < rows.length(); i++) {
            StorySummary s = StorySummary.fromJson(rows.optJSONObject(i));
            if (!s.id.isEmpty() && !s.title.isEmpty()) {
                StoryCardAdapter.StoryItem item = new StoryCardAdapter.StoryItem(
                    s.id, s.title, s.author, "", s.ratingAvg, s.ratingCount, s.totalChapters,
                    favorites.contains(s.id), s.coverUrl);
                if (showReason) item.progressSummary = rows.optJSONObject(i).optString("recommendationReason", "");
                stories.add(item);
            }
        }
        StoryCardAdapter adapter = new StoryCardAdapter(this, stories, this::toggleFavorite);
        for (int i = 0; i < stories.size(); i++) {
            StoryCardAdapter.StoryItem story = stories.get(i);
            View card = adapter.getView(i, null, container);
            if (showReason) {
                TextView reason = card.findViewById(R.id.story_card_progress);
                reason.setMaxLines(4);
                reason.setEllipsize(android.text.TextUtils.TruncateAt.END);
                reason.setContentDescription(story.progressSummary);
            }
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(142), LinearLayout.LayoutParams.WRAP_CONTENT);
            params.setMarginEnd(dp(14));
            card.setLayoutParams(params);
            card.setOnClickListener(v -> {
                Intent intent = new Intent(this, StoryDetailActivity.class);
                intent.putExtra(StoryDetailActivity.EXTRA_STORY_ID, story.id);
                startActivity(intent);
            });
            container.addView(card);
        }
    }

    private void toggleFavorite(StoryCardAdapter.StoryItem story) {
        if (!updatingFavorites.add(story.id)) return;
        boolean favorite = !story.isFavorite;
        executor.execute(() -> {
            try {
                api.setFavorite(story.id, favorite);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    updatingFavorites.remove(story.id);
                    loadHome();
                });
            } catch (Exception exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    updatingFavorites.remove(story.id);
                    Toast.makeText(this, exception instanceof CatalogApiClient.ApiException
                            ? exception.getMessage() : getString(R.string.catalog_connection_error), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onDestroy() { executor.shutdownNow(); notificationExecutor.shutdownNow(); super.onDestroy(); }
}
