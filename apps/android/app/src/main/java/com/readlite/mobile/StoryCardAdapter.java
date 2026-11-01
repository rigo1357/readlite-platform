package com.readlite.mobile;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;

import java.util.List;

public final class StoryCardAdapter extends BaseAdapter {
    public interface FavoriteListener {
        void onFavoriteClick(StoryItem story);
    }

    public interface StoryClickListener {
        void onStoryClick(StoryItem story);
    }

    public static final class StoryItem {
        public final String id;
        public final String title;
        public final String author;
        public final String genres;
        public final String coverUrl;
        public final double rating;
        public final int ratingCount;
        public final int totalChapters;
        public boolean isFavorite;
        public String progressChapterId;
        public int progressPermille;
        public String progressSummary;

        public StoryItem(
                String id,
                String title,
                String author,
                String genres,
                double rating,
                int ratingCount,
                int totalChapters
        ) {
            this(id, title, author, genres, rating, ratingCount, totalChapters, false, "");
        }

        public StoryItem(
                String id,
                String title,
                String author,
                String genres,
                double rating,
                int ratingCount,
                int totalChapters,
                boolean favorite
        ) {
            this(id, title, author, genres, rating, ratingCount, totalChapters, favorite, "");
        }

        public StoryItem(
                String id,
                String title,
                String author,
                String genres,
                double rating,
                int ratingCount,
                int totalChapters,
                boolean favorite,
                String coverUrl
        ) {
            this.id = safeText(id);
            this.title = safeText(title);
            this.author = safeText(author);
            this.genres = safeText(genres);
            this.coverUrl = safeText(coverUrl);
            this.rating = Double.isFinite(rating) ? Math.max(0.0, Math.min(5.0, rating)) : 0.0;
            this.ratingCount = Math.max(0, ratingCount);
            this.totalChapters = Math.max(0, totalChapters);
            this.isFavorite = favorite;
        }

        private static String safeText(String value) {
            return value == null ? "" : value.trim();
        }
    }

    private final Context context;
    private final LayoutInflater inflater;
    private final List<StoryItem> stories;
    private final FavoriteListener favoriteListener;
    private final StoryClickListener storyClickListener;

    public StoryCardAdapter(
            Context context,
            List<StoryItem> stories,
            FavoriteListener favoriteListener
    ) {
        this(context, stories, favoriteListener, null);
    }

    public StoryCardAdapter(
            Context context,
            List<StoryItem> stories,
            FavoriteListener favoriteListener,
            StoryClickListener storyClickListener
    ) {
        this.context = context;
        this.inflater = LayoutInflater.from(context);
        this.stories = stories;
        this.favoriteListener = favoriteListener;
        this.storyClickListener = storyClickListener;
    }

    @Override
    public int getCount() {
        return stories.size();
    }

    @Override
    public StoryItem getItem(int position) {
        return stories.get(position);
    }

    @Override
    public long getItemId(int position) {
        return position;
    }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        View row = convertView == null
                ? inflater.inflate(R.layout.item_story_card, parent, false)
                : convertView;
        StoryItem story = getItem(position);

        ImageView cover = row.findViewById(R.id.story_card_cover);
        TextView coverPlaceholder = row.findViewById(R.id.story_card_cover_placeholder);
        TextView title = row.findViewById(R.id.story_card_title);
        TextView author = row.findViewById(R.id.story_card_author);
        TextView genres = row.findViewById(R.id.story_card_genres);
        TextView metadata = row.findViewById(R.id.story_card_metadata);
        TextView progress = row.findViewById(R.id.story_card_progress);
        MaterialButton favoriteButton = row.findViewById(R.id.story_card_favorite);

        title.setText(story.title);
        author.setText(story.author);
        author.setVisibility(story.author.isEmpty() ? View.GONE : View.VISIBLE);
        if (story.genres.isEmpty()) {
            genres.setVisibility(View.GONE);
        } else {
            genres.setVisibility(View.VISIBLE);
            genres.setText(story.genres);
        }
        if (story.ratingCount == 0) {
            metadata.setText(context.getString(
                    R.string.catalog_story_meta_unrated,
                    story.totalChapters
            ));
        } else {
            metadata.setText(context.getString(
                    R.string.catalog_story_meta,
                    story.totalChapters,
                    story.rating,
                    story.ratingCount
            ));
        }

        if (story.progressSummary == null || story.progressSummary.isEmpty()) {
            progress.setVisibility(View.GONE);
        } else {
            progress.setVisibility(View.VISIBLE);
            progress.setText(story.progressSummary);
        }

        StoryCoverLoader.bind(story.coverUrl, story.title, cover, coverPlaceholder);
        stylePlaceholder(coverPlaceholder, story.title);
        favoriteButton.setText(story.isFavorite ? "♥" : "♡");
        favoriteButton.setContentDescription(context.getString(
                story.isFavorite ? R.string.story_remove_favorite : R.string.story_add_favorite,
                story.title
        ));
        favoriteButton.setOnClickListener(view -> {
            if (favoriteListener != null) {
                favoriteListener.onFavoriteClick(story);
            }
        });
        row.setOnClickListener(view -> {
            if (storyClickListener != null) storyClickListener.onStoryClick(story);
        });
        return row;
    }

    private void stylePlaceholder(TextView placeholder, String title) {
        int[][] palettes = {
                {0xFF553C4A, 0xFF9D6B73},
                {0xFF344B63, 0xFF7897AA},
                {0xFF5B4935, 0xFFAA8459},
                {0xFF354A40, 0xFF77957D},
                {0xFF4E405F, 0xFF9280A8},
                {0xFF674536, 0xFFB98161}
        };
        int palette = Math.floorMod(title.hashCode(), palettes.length);
        GradientDrawable background = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                palettes[palette]
        );
        background.setCornerRadius(dp(10));
        background.setStroke(dp(1), 0x44FFFFFF);
        placeholder.setBackground(background);
        placeholder.setGravity(Gravity.BOTTOM | Gravity.START);
        placeholder.setPadding(dp(12), dp(18), dp(12), dp(14));
        placeholder.setTypeface(Typeface.create("serif", Typeface.BOLD));
        placeholder.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        placeholder.setTextColor(Color.WHITE);
        placeholder.setShadowLayer(dp(3), 0, dp(1), 0x99000000);
    }

    private int dp(float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
}
