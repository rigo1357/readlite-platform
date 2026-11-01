package com.readlite.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.GridView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;


import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.MaterialAutoCompleteTextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

public final class CatalogActivity extends AppCompatActivity {
    public static final String EXTRA_START_SORT = "start_sort";
    private static final int PAGE_LIMIT = 20;

    private final java.util.concurrent.ExecutorService networkExecutor =
            java.util.concurrent.Executors.newSingleThreadExecutor();
    private final CatalogApiClient apiClient = new CatalogApiClient();

    private final ArrayList<String> genreNames = new ArrayList<>();
    private final ArrayList<String> genreSlugs = new ArrayList<>();
    private final ArrayList<StoryCardAdapter.StoryItem> stories = new ArrayList<>();
    private final Set<String> favoriteUpdates = new HashSet<>();

    private EditText searchInput;
    private MaterialAutoCompleteTextView genreInput;
    private String selectedGenreSlug = "";
    private Spinner sortSpinner;
    private Spinner lifecycleSpinner;
    private final String[] lifecycleValues = { "", "ongoing", "completed", "paused" };
    private TextView statusText;
    private GridView storyList;
    private MaterialButton searchButton;
    private MaterialButton loadMoreButton;
    private BottomNavigationView bottomNavigation;
    private ArrayAdapter<String> genreAdapter;
    private StoryCardAdapter storyAdapter;

    private final String[] sortValues = {
            "newest",
            "most_read",
            "trending",
            "top_rated"
    };

    private int currentPage;
    private int totalPages = 1;
    private boolean loading;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_catalog);
        SystemBarInsets.apply(findViewById(R.id.catalog_root));

        searchInput = findViewById(R.id.catalog_search_input);
        genreInput = findViewById(R.id.catalog_genre_input);
        sortSpinner = findViewById(R.id.catalog_sort_spinner);
        lifecycleSpinner = findViewById(R.id.catalog_lifecycle_spinner);
        ArrayAdapter<String> lifecycleAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item,
                new String[]{"Tất cả trạng thái", "Đang ra", "Hoàn thành", "Tạm ngưng"});
        lifecycleAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        lifecycleSpinner.setAdapter(lifecycleAdapter);
        if (savedInstanceState != null) lifecycleSpinner.setSelection(Math.max(0, Math.min(3, savedInstanceState.getInt("lifecycle_filter", 0))));
        statusText = findViewById(R.id.catalog_status);
        storyList = findViewById(R.id.catalog_story_list);
        searchButton = findViewById(R.id.catalog_search_button);
        loadMoreButton = findViewById(R.id.catalog_load_more_button);
        bottomNavigation = findViewById(R.id.catalog_bottom_navigation);

        genreNames.add(getString(R.string.catalog_genre_all));
        genreSlugs.add("");

        genreAdapter = new ArrayAdapter<>(
                this,
                android.R.layout.simple_dropdown_item_1line,
                genreNames
        );
        genreInput.setAdapter(genreAdapter);
        genreInput.setThreshold(1);
        genreInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable value) {
                if (!genreNames.contains(value.toString().trim())) {
                    selectedGenreSlug = "";
                }
            }
        });
        genreInput.setOnItemClickListener((parent, view, position, id) -> {
            String selectedName = String.valueOf(parent.getItemAtPosition(position));
            int selectedIndex = genreNames.indexOf(selectedName);
            selectedGenreSlug = selectedIndex >= 0 && selectedIndex < genreSlugs.size()
                    ? genreSlugs.get(selectedIndex)
                    : "";
            loadStories(true);
        });

        String[] sortLabels = {
                getString(R.string.catalog_sort_newest),
                getString(R.string.catalog_sort_most_read),
                getString(R.string.catalog_sort_trending),
                getString(R.string.catalog_sort_top_rated)
        };

        ArrayAdapter<String> sortAdapter = new ArrayAdapter<>(
                this,
                android.R.layout.simple_spinner_item,
                sortLabels
        );
        sortAdapter.setDropDownViewResource(
                android.R.layout.simple_spinner_dropdown_item
        );
        sortSpinner.setAdapter(sortAdapter);
        if ("top_rated".equals(getIntent().getStringExtra(EXTRA_START_SORT))) {
            sortSpinner.setSelection(3);
        }

        storyAdapter = new StoryCardAdapter(this, stories, this::toggleFavorite, this::openStory);
        storyList.setAdapter(storyAdapter);

        searchButton.setOnClickListener(view -> loadStories(true));
        loadMoreButton.setOnClickListener(view -> loadStories(false));

        PrimaryNavigation.bind(this, R.id.catalog_bottom_navigation, R.id.catalog_nav_explore);
        searchInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH) {
                loadStories(true);
                return true;
            }
            return false;
        });
        sortSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                loadStories(true);
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) { }
        });

        loadGenres();
        lifecycleSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { loadStories(true); }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) { }
        });
        loadStories(true);
    }

    private void openStory(StoryCardAdapter.StoryItem story) {
        Intent intent = new Intent(this, StoryDetailActivity.class);
        intent.putExtra(StoryDetailActivity.EXTRA_STORY_ID, story.id);
        startActivity(intent);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if ("top_rated".equals(intent.getStringExtra(EXTRA_START_SORT))) {
            sortSpinner.setSelection(3);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshFavoriteStates();
    }

    private void refreshFavoriteStates() {
        networkExecutor.execute(() -> {
            try {
                JSONObject body = apiClient.getLibrary();
                JSONArray libraryStories = body.optJSONArray("stories");
                Set<String> favoriteIds = new HashSet<>();
                if (libraryStories != null) {
                    for (int index = 0; index < libraryStories.length(); index++) {
                        JSONObject item = libraryStories.optJSONObject(index);
                        if (item != null && item.optBoolean("isFavorite")) {
                            favoriteIds.add(item.optString("id"));
                        }
                    }
                }
                applyFavoriteStates(favoriteIds);
            } catch (CatalogApiClient.ApiException exception) {
                if (exception.getStatusCode() == 401) {
                    applyFavoriteStates(new HashSet<>());
                }
            } catch (IOException | JSONException ignored) {
                // Giữ trạng thái hiển thị gần nhất nếu API tạm thời mất kết nối.
            }
        });
    }

    private void applyFavoriteStates(Set<String> favoriteIds) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) {
                return;
            }
            for (StoryCardAdapter.StoryItem story : stories) {
                story.isFavorite = favoriteIds.contains(story.id);
            }
            storyAdapter.notifyDataSetChanged();
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
                    storyAdapter.notifyDataSetChanged();
                    statusText.setText(requestedFavorite
                            ? R.string.story_added_to_library
                            : R.string.story_removed_from_library);
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    favoriteUpdates.remove(story.id);
                    if (exception instanceof CatalogApiClient.ApiException
                            && ((CatalogApiClient.ApiException) exception).getStatusCode() == 401) {
                        statusText.setText(R.string.library_sign_in_required);
                    } else {
                        statusText.setText(R.string.catalog_connection_error);
                    }
                });
            }
        });
    }
    private void loadGenres() {
        networkExecutor.execute(() -> {
            try {
                JSONObject body = apiClient.getGenres(null);
                JSONArray genres = body.optJSONArray("genres");

                if (genres == null) {
                    return;
                }

                ArrayList<String> names = new ArrayList<>();
                ArrayList<String> slugs = new ArrayList<>();

                names.add(getString(R.string.catalog_genre_all));
                slugs.add("");

                for (int index = 0; index < genres.length(); index++) {
                    JSONObject genre = genres.optJSONObject(index);

                    if (genre == null) {
                        continue;
                    }

                    names.add(genre.optString("name"));
                    slugs.add(genre.optString("slug"));
                }

                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }

                    genreNames.clear();
                    genreNames.addAll(names);
                    genreSlugs.clear();
                    genreSlugs.addAll(slugs);
                    genreAdapter.notifyDataSetChanged();
                    genreInput.setHint("Tìm trong " + (names.size() - 1) + " thể loại");
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        genreInput.setHint("Không tải được thể loại");
                    }
                });
            }
        });
    }

    private void loadStories(boolean reset) {
        if (loading) {
            return;
        }

        if (reset) {
            currentPage = 0;
            stories.clear();
            storyAdapter.notifyDataSetChanged();
        }

        int requestedPage = reset ? 1 : currentPage + 1;
        String query = searchInput.getText().toString().trim();

        String genre = selectedGenreSlug;
        int lifecycleIndex = lifecycleSpinner.getSelectedItemPosition();
        String lifecycle = lifecycleIndex >= 0 && lifecycleIndex < lifecycleValues.length ? lifecycleValues[lifecycleIndex] : "";

        int sortIndex = sortSpinner.getSelectedItemPosition();
        String sort = sortIndex >= 0 && sortIndex < sortValues.length
                ? sortValues[sortIndex]
                : "newest";

        loading = true;
        lifecycleSpinner.setEnabled(false);
        sortSpinner.setEnabled(false);
        genreInput.setEnabled(false);
        searchInput.setEnabled(false);
        searchButton.setEnabled(false);
        loadMoreButton.setEnabled(false);
        statusText.setText(R.string.catalog_loading);

        networkExecutor.execute(() -> {
            try {
                JSONObject body = apiClient.getStories(
                        query,
                        genre,
                        sort,
                        requestedPage,
                        PAGE_LIMIT,
                        lifecycle
                );

                JSONArray results = body.optJSONArray("stories");
                JSONObject pagination = body.optJSONObject("pagination");

                int pageCount = pagination == null
                        ? 1
                        : pagination.optInt("totalPages", 1);
                int total = pagination == null
                        ? 0
                        : pagination.optInt("total", 0);

                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }

                    if (results != null) {
                        appendStories(results);
                    }

                    currentPage = requestedPage;
                    totalPages = Math.max(pageCount, 1);
                    loading = false;
                    lifecycleSpinner.setEnabled(true); sortSpinner.setEnabled(true); genreInput.setEnabled(true); searchInput.setEnabled(true);
                    searchButton.setEnabled(true);
                    loadMoreButton.setEnabled(true);
                    loadMoreButton.setVisibility(
                            currentPage < totalPages ? View.VISIBLE : View.GONE
                    );

                    if (total == 0) {
                        statusText.setText(R.string.catalog_no_stories);
                    } else {
                        statusText.setText(
                                getString(R.string.catalog_result_count, total)
                        );
                    }
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }

                    loading = false;
                    lifecycleSpinner.setEnabled(true); sortSpinner.setEnabled(true); genreInput.setEnabled(true); searchInput.setEnabled(true);
                    searchButton.setEnabled(true);
                    loadMoreButton.setEnabled(true);
                    statusText.setText(R.string.catalog_connection_error);
                });
            }
        });
    }

    private void appendStories(JSONArray results) {
        for (int index = 0; index < results.length(); index++) {
            JSONObject story = results.optJSONObject(index);

            if (story == null) {
                continue;
            }

            StorySummary summary = StorySummary.fromJson(story);
            if (summary.id.isEmpty() || summary.title.isEmpty()) {
                continue;
            }

            stories.add(new StoryCardAdapter.StoryItem(
                    summary.id,
                    summary.title,
                    summary.author,
                    formatGenres(story.optJSONArray("genres")) + " · " + StoryLifecycleLabels.label(story.optString("lifecycleStatus", "ongoing")),
                    summary.ratingAvg,
                    summary.ratingCount,
                    summary.totalChapters,
                    false,
                    summary.coverUrl
            ));
        }

        storyAdapter.notifyDataSetChanged();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putInt("lifecycle_filter", lifecycleSpinner.getSelectedItemPosition());
        super.onSaveInstanceState(state);
    }

    private String formatGenres(JSONArray genres) {
        if (genres == null || genres.length() == 0) {
            return "";
        }

        StringBuilder names = new StringBuilder();

        for (int index = 0; index < genres.length(); index++) {
            JSONObject genre = genres.optJSONObject(index);

            if (genre == null) {
                continue;
            }

            String name = genre.optString("name", "");
            if (name.isEmpty()) {
                continue;
            }

            if (names.length() > 0) {
                names.append(" · ");
            }
            names.append(name);
        }

        return names.toString();
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
