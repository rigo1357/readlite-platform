package com.readlite.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.EditText;
import android.widget.RatingBar;
import android.text.InputFilter;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.tabs.TabLayout;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class StoryDetailActivity extends AppCompatActivity {
    public static final String EXTRA_STORY_ID = "story_id";

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final CatalogApiClient apiClient = new CatalogApiClient();

    private String storyId;
    private boolean isFavorite;
    private TextView statusText;
    private ImageView coverImage;
    private TextView coverPlaceholder;
    private TextView titleText;
    private TextView authorText;
    private TextView ratingText;
    private TextView genresText;
    private TextView summaryText;
    private LinearLayout chapterList;
    private MaterialButton favoriteButton;
    private JSONObject myReview;
    private int reviewPage;
    private boolean reviewsLoading;
    private boolean reviewMutation;
    private int reviewGeneration;
    private int draftRating = -1;
    private String draftContent;
    private boolean following;
    private boolean followKnown;
    private boolean followBusy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_story_detail);
        SystemBarInsets.apply(findViewById(R.id.story_detail_root));

        storyId = getIntent().getStringExtra(EXTRA_STORY_ID);
        statusText = findViewById(R.id.story_detail_status);
        coverImage = findViewById(R.id.story_detail_cover);
        coverPlaceholder = findViewById(R.id.story_detail_cover_placeholder);
        titleText = findViewById(R.id.story_detail_title);
        authorText = findViewById(R.id.story_detail_author);
        ratingText = findViewById(R.id.story_detail_rating);
        genresText = findViewById(R.id.story_detail_genres);
        summaryText = findViewById(R.id.story_detail_summary);
        chapterList = findViewById(R.id.story_chapter_list);
        favoriteButton = findViewById(R.id.story_detail_favorite);
        findViewById(R.id.story_detail_back_button).setOnClickListener(view -> finish());
        favoriteButton.setOnClickListener(view -> toggleFavorite());
        favoriteButton.setEnabled(false);
        findViewById(R.id.story_detail_follow).setOnClickListener(view -> {
            if (!followKnown) loadFollow();
            else toggleFollow();
        });
        findViewById(R.id.story_detail_comments).setOnClickListener(view -> {
            Intent intent = new Intent(this, CommentsActivity.class);
            intent.putExtra(CommentsActivity.EXTRA_STORY_ID, storyId);
            startActivity(intent);
        });
        findViewById(R.id.story_detail_report).setOnClickListener(view -> ReportDialog.show(this, "story", storyId));
        TabLayout tabs = findViewById(R.id.story_detail_tabs);
        tabs.addTab(tabs.newTab().setText("Giới thiệu"));
        tabs.addTab(tabs.newTab().setText("Danh sách chương"));
        tabs.addTab(tabs.newTab().setText("Đánh giá"));
        tabs.setTabMode(TabLayout.MODE_SCROLLABLE);
        findViewById(R.id.story_review_write).setOnClickListener(view -> editReview());
        findViewById(R.id.story_review_delete).setOnClickListener(view ->
                new MaterialAlertDialogBuilder(this).setTitle("Xóa đánh giá?")
                        .setMessage("Điểm và nhận xét của bạn sẽ được xóa khỏi truyện này.")
                        .setNegativeButton("Hủy", null)
                        .setPositiveButton("Xóa", (dialog, which) -> mutateReview(0, "", true)).show());
        findViewById(R.id.story_review_more).setOnClickListener(view -> loadReviews(false));
        findViewById(R.id.story_review_status).setOnClickListener(view -> loadReviews(true));
        tabs.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override public void onTabSelected(TabLayout.Tab tab) {
                findViewById(R.id.story_detail_overview).setVisibility(tab.getPosition() == 0 ? View.VISIBLE : View.GONE);
                chapterList.setVisibility(tab.getPosition() == 1 ? View.VISIBLE : View.GONE);
                findViewById(R.id.story_review_panel).setVisibility(tab.getPosition() == 2 ? View.VISIBLE : View.GONE);
                if (tab.getPosition() == 2) loadReviews(true);
            }
            @Override public void onTabUnselected(TabLayout.Tab tab) { }
            @Override public void onTabReselected(TabLayout.Tab tab) { }
        });

        if (storyId == null || storyId.isEmpty()) {
            statusText.setText(R.string.catalog_connection_error);
            return;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (storyId != null && !storyId.isEmpty()) loadStory();
        if (storyId != null && !storyId.isEmpty()) loadFollow();
        TabLayout tabs = findViewById(R.id.story_detail_tabs);
        if (storyId != null && tabs.getSelectedTabPosition() == 2) loadReviews(true);
    }

    private void loadStory() {
        networkExecutor.execute(() -> {
            try {
                JSONObject story = apiClient.getStory(storyId).getJSONObject("story");
                JSONObject chapterResponse = apiClient.getChapters(storyId);
                JSONArray chapters = chapterResponse.optJSONArray("chapters");
                boolean favorite = false;
                String progressChapterId = "";
                try {
                    JSONArray savedStories = apiClient.getLibrary().optJSONArray("stories");
                    if (savedStories != null) {
                        for (int index = 0; index < savedStories.length(); index++) {
                            JSONObject saved = savedStories.optJSONObject(index);
                            if (saved != null && storyId.equals(saved.optString("id"))) {
                                favorite = saved.optBoolean("isFavorite", false);
                                JSONObject progress = saved.optJSONObject("readingProgress");
                                if (progress != null) progressChapterId = progress.optString("chapterId", "");
                                break;
                            }
                        }
                    }
                } catch (IOException | JSONException ignored) {
                    // Chi tiết truyện công khai vẫn xem được khi chưa đăng nhập.
                }
                boolean savedFavorite = favorite;
                String savedProgressChapterId = progressChapterId;
                JSONArray savedChapters = chapters == null ? new JSONArray() : chapters;
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        renderStory(story, savedChapters, savedFavorite);
                        configureReadButton(savedChapters, savedProgressChapterId);
                    }
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        statusText.setText(R.string.catalog_connection_error);
                    }
                });
            }
        });
    }

    private void renderStory(JSONObject story, JSONArray chapters, boolean favorite) {
        statusText.setVisibility(View.GONE);
        String title = story.optString("title", "");
        titleText.setText(title);
        StoryCoverLoader.bind(
                story.optString("coverUrl", ""),
                title,
                coverImage,
                coverPlaceholder,
                164,
                244
        );
        authorText.setText(getString(R.string.story_author, story.optString("author", "")));
        ((TextView) findViewById(R.id.story_detail_lifecycle)).setText("Tiến hành: " + StoryLifecycleLabels.label(story.optString("lifecycleStatus", "ongoing")));
        ratingText.setText(getString(
                R.string.story_rating,
                story.optDouble("ratingAvg", 0),
                story.optInt("ratingCount", 0)
        ));
        summaryText.setText(story.optString("summary", ""));
        isFavorite = favorite;
        favoriteButton.setEnabled(true);
        renderFavoriteButton();

        JSONArray genres = story.optJSONArray("genres");
        StringBuilder genreNames = new StringBuilder();
        if (genres != null) {
            for (int index = 0; index < genres.length(); index++) {
                JSONObject genre = genres.optJSONObject(index);
                if (genre == null) {
                    continue;
                }
                if (genreNames.length() > 0) {
                    genreNames.append(" · ");
                }
                genreNames.append(genre.optString("name", ""));
            }
        }
        genresText.setText(getString(
                R.string.story_genres,
                genreNames.length() == 0
                        ? getString(R.string.catalog_genre_all)
                        : genreNames.toString()
        ));

        chapterList.removeAllViews();
        if (chapters.length() == 0) {
            TextView empty = new TextView(this);
            empty.setText(R.string.story_no_chapters);
            empty.setTextColor(getColor(R.color.readlite_muted));
            empty.setPadding(0, 12, 0, 12);
            chapterList.addView(empty);
            return;
        }

        for (int index = 0; index < chapters.length(); index++) {
            addChapterButton(chapters.optJSONObject(index), index);
        }
    }

    private void configureReadButton(JSONArray chapters, String savedChapterId) {
        java.util.ArrayList<String> chapterIds = new java.util.ArrayList<>();
        for (int i = 0; i < chapters.length(); i++) {
            JSONObject chapter = chapters.optJSONObject(i);
            if (chapter != null) chapterIds.add(chapter.optString("id", ""));
        }
        ReaderChapterSelection.Selection selection = ReaderChapterSelection.choose(chapterIds, "", savedChapterId, true);
        MaterialButton readButton = findViewById(R.id.story_detail_read_now);
        readButton.setEnabled(selection.chapterId != null);
        boolean resume = selection.chapterId != null && selection.chapterId.equals(savedChapterId);
        readButton.setText(selection.chapterId == null ? "Chưa có chương để đọc" : resume ? "Đọc tiếp" : "Bắt đầu đọc");
        readButton.setOnClickListener(view -> {
            if (selection.chapterId == null) return;
            Intent reader = new Intent(this, ChapterReaderActivity.class);
            reader.putExtra(ChapterReaderActivity.EXTRA_STORY_ID, storyId);
            reader.putExtra(ChapterReaderActivity.EXTRA_CHAPTER_ID, selection.chapterId);
            reader.putExtra(ChapterReaderActivity.EXTRA_RESUME_READING, resume);
            startActivity(reader);
        });
    }

    private void addChapterButton(JSONObject chapter, int index) {
        if (chapter == null) {
            return;
        }
        String chapterId = chapter.optString("id", "");
        if (chapterId.trim().isEmpty()) {
            return;
        }
        int chapterOrder = chapter.optInt("chapterOrder", index + 1);
        String chapterTitle = chapter.optString("title", "");
        View row = getLayoutInflater().inflate(R.layout.item_story_chapter, chapterList, false);
        TextView number = row.findViewById(R.id.story_chapter_number);
        TextView title = row.findViewById(R.id.story_chapter_title);
        number.setText(String.format(Locale.ROOT, "%02d", chapterOrder));
        title.setText(ChapterLabels.shortTitle(chapterOrder, chapterTitle));
        row.setContentDescription(ChapterLabels.fullLabel(this, chapterOrder, chapterTitle));
        row.setOnClickListener(view -> {
            Intent intent = new Intent(this, ChapterReaderActivity.class);
            intent.putExtra(ChapterReaderActivity.EXTRA_STORY_ID, storyId);
            intent.putExtra(ChapterReaderActivity.EXTRA_CHAPTER_ID, chapterId);
            startActivity(intent);
        });
        chapterList.addView(row);
    }
    private void toggleFavorite() {
        favoriteButton.setEnabled(false);
        boolean requestedFavorite = !isFavorite;
        networkExecutor.execute(() -> {
            try {
                apiClient.setFavorite(storyId, requestedFavorite);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    isFavorite = requestedFavorite;
                    favoriteButton.setEnabled(true);
                    renderFavoriteButton();
                    statusText.setVisibility(View.VISIBLE);
                    statusText.setText(requestedFavorite
                            ? R.string.story_added_to_library
                            : R.string.story_removed_from_library);
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    favoriteButton.setEnabled(true);
                    statusText.setVisibility(View.VISIBLE);
                    statusText.setText(exception instanceof CatalogApiClient.ApiException
                            && ((CatalogApiClient.ApiException) exception).getStatusCode() == 401
                            ? R.string.library_sign_in_required
                            : R.string.catalog_connection_error);
                });
            }
        });
    }

    private void loadFollow() {
        if (followBusy) return;
        followBusy = true;
        MaterialButton button = findViewById(R.id.story_detail_follow);
        button.setEnabled(false);
        networkExecutor.execute(() -> {
            try {
                boolean saved = apiClient.getStoryFollow(storyId).optBoolean("following");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    followBusy = false;
                    followKnown = true;
                    following = saved;
                    button.setEnabled(true);
                    button.setText(saved ? "Đang theo dõi · Bỏ theo dõi" : "Theo dõi chương mới");
                });
            } catch (IOException | JSONException error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    followBusy = false;
                    followKnown = error instanceof CatalogApiClient.ApiException && ((CatalogApiClient.ApiException) error).getStatusCode() == 401;
                    following = false;
                    button.setEnabled(true);
                    button.setText(followKnown ? "Theo dõi chương mới" : "Tải lại trạng thái theo dõi");
                });
            }
        });
    }

    private void toggleFollow() {
        if (followBusy) return;
        boolean requested = !following;
        followBusy = true;
        MaterialButton button = findViewById(R.id.story_detail_follow);
        button.setEnabled(false);
        networkExecutor.execute(() -> {
            try {
                apiClient.setStoryFollow(storyId, requested);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    followBusy = false;
                    following = requested;
                    button.setEnabled(true);
                    button.setText(requested ? "Đang theo dõi · Bỏ theo dõi" : "Theo dõi chương mới");
                    statusText.setVisibility(View.VISIBLE);
                    statusText.setText(requested ? "Đã theo dõi. Chương mới sẽ xuất hiện trong mục Thông báo." : "Đã bỏ theo dõi. Bạn sẽ không nhận thêm cập nhật của truyện này.");
                });
            } catch (IOException | JSONException error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    followBusy = false;
                    button.setEnabled(true);
                    statusText.setVisibility(View.VISIBLE);
                    statusText.setText(error instanceof CatalogApiClient.ApiException ? error.getMessage() : "Không cập nhật được theo dõi. Hãy thử lại.");
                });
            }
        });
    }

    private void renderFavoriteButton() {
        favoriteButton.setText(isFavorite
                ? R.string.story_favorite_saved
                : R.string.story_favorite_add);
    }

    private void loadReviews(boolean reset) {
        if (reviewsLoading || reviewMutation || storyId == null || storyId.isEmpty()) return;
        reviewsLoading = true;
        int generation = ++reviewGeneration;
        int page = reset ? 1 : reviewPage + 1;
        TextView status = findViewById(R.id.story_review_status);
        status.setText("Đang tải đánh giá…");
        findViewById(R.id.story_review_more).setEnabled(false);
        findViewById(R.id.story_review_write).setEnabled(false);
        findViewById(R.id.story_review_delete).setEnabled(false);
        networkExecutor.execute(() -> {
            try {
                JSONObject body = apiClient.getReviews(storyId, page);
                JSONObject own = myReview;
                if (reset) {
                    try { own = apiClient.getMyReview(storyId).optJSONObject("review"); }
                    catch (CatalogApiClient.ApiException error) {
                        if (error.getStatusCode() != 401) throw error;
                        own = null;
                    }
                }
                JSONObject savedOwn = own;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || generation != reviewGeneration) return;
                    reviewsLoading = false;
                    reviewPage = page;
                    myReview = savedOwn;
                    LinearLayout list = findViewById(R.id.story_review_list);
                    if (reset) list.removeAllViews();
                    JSONArray items = body.optJSONArray("reviews");
                    if (items != null) for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.optJSONObject(i);
                        if (item == null) continue;
                        TextView row = new TextView(this);
                        String stars = "★★★★★".substring(0, Math.max(0, Math.min(5, item.optInt("rating"))));
                        String date = item.optString("updatedAt", "");
                        if (date.length() >= 10) date = date.substring(0, 10);
                        row.setText(item.optString("displayName", "Độc giả") + " · " + stars + "\n" + date + "\n" + item.optString("content", ""));
                        row.setTextSize(15);
                        row.setTextColor(getColor(R.color.readlite_ink));
                        row.setPadding(0, 24, 0, 24);
                        list.addView(row);
                        MaterialButton report = new MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
                        report.setText("Báo cáo đánh giá");
                        report.setAllCaps(false);
                        report.setOnClickListener(view -> ReportDialog.show(this, "review", item.optString("id")));
                        list.addView(report);
                    }
                    int count = body.optInt("ratingCount");
                    double average = body.optDouble("ratingAvg");
                    ((TextView) findViewById(R.id.story_review_summary)).setText(count == 0 ? "Chưa có đánh giá" : String.format(Locale.getDefault(), "%.1f/5 · %d đánh giá", average, count));
                    ratingText.setText(getString(R.string.story_rating, average, count));
                    status.setText(count == 0 ? "Hãy chia sẻ cảm nhận đầu tiên về truyện." : "");
                    MaterialButton write = findViewById(R.id.story_review_write);
                    write.setText(myReview == null ? "Viết đánh giá" : "Sửa đánh giá của tôi");
                    write.setEnabled(true);
                    TextView ownText = findViewById(R.id.story_review_own);
                    ownText.setVisibility(myReview == null ? View.GONE : View.VISIBLE);
                    if (myReview != null) ownText.setText("Đánh giá của bạn: " + myReview.optInt("rating") + "/5\n" + myReview.optString("content"));
                    findViewById(R.id.story_review_delete).setVisibility(myReview == null ? View.GONE : View.VISIBLE);
                    findViewById(R.id.story_review_delete).setEnabled(true);
                    findViewById(R.id.story_review_more).setVisibility(page * 10 < count ? View.VISIBLE : View.GONE);
                    findViewById(R.id.story_review_more).setEnabled(true);
                });
            } catch (IOException | JSONException error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || generation != reviewGeneration) return;
                    reviewsLoading = false;
                    status.setText("Không tải được đánh giá. Chạm vào đây để thử lại.");
                    findViewById(R.id.story_review_more).setEnabled(true);
                    findViewById(R.id.story_review_write).setEnabled(true);
                    findViewById(R.id.story_review_delete).setEnabled(true);
                });
            }
        });
    }

    private void editReview() {
        if (reviewMutation || reviewsLoading) return;
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        form.setPadding(padding, 0, padding, 0);
        RatingBar stars = new RatingBar(this);
        stars.setNumStars(5);
        stars.setStepSize(1);
        stars.setRating(draftRating >= 0 ? draftRating : myReview == null ? 0 : myReview.optInt("rating"));
        stars.setContentDescription("Chọn điểm từ 1 đến 5 sao");
        form.addView(stars, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        EditText content = new EditText(this);
        content.setHint("Nhận xét của bạn (không bắt buộc, tối đa 5000 ký tự)");
        content.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        content.setMinLines(3);
        content.setMaxLines(8);
        content.setFilters(new InputFilter[]{new InputFilter.LengthFilter(5000)});
        if (draftContent != null) content.setText(draftContent);
        else if (myReview != null) content.setText(myReview.optString("content"));
        form.addView(content);
        androidx.appcompat.app.AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(myReview == null ? "Đánh giá truyện" : "Sửa đánh giá")
                .setView(form).setNegativeButton("Hủy", null).setPositiveButton("Lưu", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            int rating = Math.round(stars.getRating());
            if (rating < 1 || rating > 5) {
                content.setError("Vui lòng chọn từ 1 đến 5 sao.");
                return;
            }
            dialog.dismiss();
            draftRating = rating;
            draftContent = content.getText().toString().trim();
            mutateReview(rating, draftContent, false);
        }));
        dialog.show();
    }

    private void mutateReview(int rating, String content, boolean delete) {
        if (reviewMutation || reviewsLoading) return;
        reviewMutation = true;
        findViewById(R.id.story_review_write).setEnabled(false);
        findViewById(R.id.story_review_delete).setEnabled(false);
        findViewById(R.id.story_review_more).setEnabled(false);
        TextView status = findViewById(R.id.story_review_status);
        status.setText(delete ? "Đang xóa đánh giá…" : "Đang lưu đánh giá…");
        networkExecutor.execute(() -> {
            try {
                if (delete) apiClient.deleteReview(storyId);
                else apiClient.saveReview(storyId, rating, content);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    reviewMutation = false;
                    draftRating = -1;
                    draftContent = null;
                    loadReviews(true);
                });
            } catch (IOException | JSONException error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    reviewMutation = false;
                    status.setText(error instanceof CatalogApiClient.ApiException ? error.getMessage() : "Chưa lưu được đánh giá. Hãy kiểm tra kết nối và thử lại.");
                    findViewById(R.id.story_review_write).setEnabled(true);
                    findViewById(R.id.story_review_delete).setEnabled(true);
                    findViewById(R.id.story_review_more).setEnabled(true);
                });
            }
        });
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
