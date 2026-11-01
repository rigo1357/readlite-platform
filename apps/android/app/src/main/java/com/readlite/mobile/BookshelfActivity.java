package com.readlite.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.GridView;
import android.widget.TextView;
import android.widget.EditText;
import android.text.Editable;
import android.text.TextWatcher;
import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class BookshelfActivity extends AppCompatActivity {
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final CatalogApiClient apiClient = new CatalogApiClient();
    private final ArrayList<StoryCardAdapter.StoryItem> stories = new ArrayList<>();
    private final ArrayList<StoryCardAdapter.StoryItem> allStories = new ArrayList<>();
    private final Set<String> favoriteUpdates = new HashSet<>();

    private TextView statusText;
    private MaterialButton signInButton;
    private StoryCardAdapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_bookshelf);
        SystemBarInsets.apply(findViewById(R.id.bookshelf_root));

        statusText = findViewById(R.id.bookshelf_status);
        signInButton = findViewById(R.id.bookshelf_sign_in_button);
        GridView storyList = findViewById(R.id.bookshelf_story_list);
        BottomNavigationView navigation = findViewById(R.id.bookshelf_bottom_navigation);
        adapter = new StoryCardAdapter(this, stories, this::toggleFavorite, this::openStory);
        storyList.setAdapter(adapter);
        signInButton.setOnClickListener(view ->
                startActivity(new Intent(this, MainActivity.class)));

        PrimaryNavigation.bind(this, R.id.bookshelf_bottom_navigation, R.id.catalog_nav_bookshelf);
        ((ChipGroup) findViewById(R.id.bookshelf_filters)).setOnCheckedStateChangeListener((group, checked) -> filterStories());
        ((EditText) findViewById(R.id.bookshelf_search)).addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence text, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence text, int start, int before, int count) { filterStories(); }
            @Override public void afterTextChanged(Editable text) { }
        });
    }

    private void filterStories() {
        String query = ((EditText) findViewById(R.id.bookshelf_search)).getText().toString().trim().toLowerCase(java.util.Locale.ROOT);
        int selected = ((ChipGroup) findViewById(R.id.bookshelf_filters)).getCheckedChipId();
        int reading = 0;
        int favorites = 0;
        stories.clear();
        for (StoryCardAdapter.StoryItem story : allStories) {
            boolean hasProgress = story.progressChapterId != null && !story.progressChapterId.isEmpty();
            if (hasProgress) reading++;
            if (story.isFavorite) favorites++;
            if (selected == R.id.bookshelf_filter_reading && !hasProgress) continue;
            if (selected == R.id.bookshelf_filter_favorites && !story.isFavorite) continue;
            if (!(story.title + " " + story.author).toLowerCase(java.util.Locale.ROOT).contains(query)) continue;
            stories.add(story);
        }
        ((Chip) findViewById(R.id.bookshelf_filter_reading)).setText("Đang đọc · " + reading);
        ((Chip) findViewById(R.id.bookshelf_filter_favorites)).setText("Yêu thích · " + favorites);
        adapter.notifyDataSetChanged();
        statusText.setText(allStories.isEmpty() ? getString(R.string.bookshelf_empty)
                : stories.isEmpty() ? "Không có truyện phù hợp."
                : getString(R.string.bookshelf_count, stories.size()));
    }

    private void openStory(StoryCardAdapter.StoryItem story) {
        Intent intent = new Intent(this, StoryDetailActivity.class);
        intent.putExtra(StoryDetailActivity.EXTRA_STORY_ID, story.id);
        startActivity(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        loadLibrary();
    }

    private void loadLibrary() {
        statusText.setText(R.string.bookshelf_loading);
        signInButton.setVisibility(View.GONE);
        networkExecutor.execute(() -> {
            try {
                JSONObject body = apiClient.getLibrary();
                JSONArray items = body.optJSONArray("stories");
                ArrayList<StoryCardAdapter.StoryItem> loaded = new ArrayList<>();
                if (items != null) {
                    for (int index = 0; index < items.length(); index++) {
                        JSONObject item = items.optJSONObject(index);
                        if (item == null) {
                            continue;
                        }
                        StoryCardAdapter.StoryItem story = new StoryCardAdapter.StoryItem(
                                item.optString("id", ""),
                                item.optString("title", ""),
                                item.optString("author", ""),
                                "",
                                item.optDouble("ratingAvg", 0),
                                item.optInt("ratingCount", 0),
                                item.optInt("totalChapters", 0),
                                item.optBoolean("isFavorite", false),
                                item.optString("coverUrl", "")
                        );
                        JSONObject progress = item.optJSONObject("readingProgress");
                        if (progress != null) {
                            story.progressChapterId = progress.optString("chapterId", "");
                            story.progressPermille = progress.optInt("positionPermille", 0);
                            int chapterOrder = progress.optInt("chapterOrder", 0);
                            story.progressSummary = getString(
                                    R.string.bookshelf_progress,
                                    chapterOrder,
                                    story.progressPermille / 10
                            );
                        }
                        loaded.add(story);
                    }
                }
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    allStories.clear();
                    allStories.addAll(loaded);
                    filterStories();
                    signInButton.setVisibility(View.GONE);
                });
            } catch (CatalogApiClient.ApiException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    stories.clear();
                    allStories.clear();
                    adapter.notifyDataSetChanged();
                    if (exception.getStatusCode() == 401) {
                        statusText.setText(R.string.library_sign_in_required);
                        signInButton.setVisibility(View.VISIBLE);
                    } else {
                        statusText.setText(R.string.catalog_connection_error);
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

    private void toggleFavorite(StoryCardAdapter.StoryItem story) {
        if (!favoriteUpdates.add(story.id)) {
            return;
        }
        boolean requestedFavorite = !story.isFavorite;
        networkExecutor.execute(() -> {
            try {
                apiClient.setFavorite(story.id, requestedFavorite);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    story.isFavorite = requestedFavorite;
                    favoriteUpdates.remove(story.id);
                    if (!story.isFavorite
                            && (story.progressChapterId == null || story.progressChapterId.isEmpty())) {
                        allStories.remove(story);
                    }
                    filterStories();
                    statusText.setText(story.isFavorite
                            ? R.string.story_added_to_library
                            : R.string.story_removed_from_library);
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    favoriteUpdates.remove(story.id);
                    if (!isFinishing() && !isDestroyed()) {
                        statusText.setText(exception instanceof CatalogApiClient.ApiException
                                && ((CatalogApiClient.ApiException) exception).getStatusCode() == 401
                                ? R.string.library_sign_in_required
                                : R.string.catalog_connection_error);
                    }
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
