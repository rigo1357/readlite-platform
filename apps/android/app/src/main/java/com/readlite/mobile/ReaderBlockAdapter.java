package com.readlite.mobile;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

public final class ReaderBlockAdapter {
    private final Context context;
    private final LinearLayout container;
    private int fontSizeSp;

    public ReaderBlockAdapter(Context context, LinearLayout container, int fontSizeSp) {
        this.context = context;
        this.container = container;
        this.fontSizeSp = fontSizeSp;
    }

    public void setFontSizeSp(int fontSizeSp) {
        this.fontSizeSp = fontSizeSp;
    }

    public void render(JSONArray blocks, String legacyContent) {
        container.removeAllViews();
        if (blocks == null || blocks.length() == 0) {
            TextView legacy = textView(legacyContent == null ? "" : legacyContent);
            legacy.setLineSpacing(dp(8), 1f);
            container.addView(legacy, matchWrap());
            return;
        }

        for (int index = 0; index < blocks.length(); index++) {
            JSONObject block = blocks.optJSONObject(index);
            if (block == null) {
                continue;
            }
            String type = block.optString("type", "");
            if ("text".equals(type)) {
                addTextBlock(block);
            } else if ("image".equals(type)) {
                addImageBlock(block);
            }
        }
    }

    private void addTextBlock(JSONObject block) {
        String kind = block.optString("kind", "paragraph");
        JSONArray runs = block.optJSONArray("runs");
        SpannableStringBuilder text = new SpannableStringBuilder();
        if (runs != null) {
            for (int index = 0; index < runs.length(); index++) {
                JSONObject run = runs.optJSONObject(index);
                if (run == null) {
                    continue;
                }
                String value = run.optString("text", "");
                int start = text.length();
                text.append(value);
                int end = text.length();
                boolean bold = run.optBoolean("bold", false);
                boolean italic = run.optBoolean("italic", false);
                if (bold || italic) {
                    int style = bold && italic
                            ? Typeface.BOLD_ITALIC
                            : bold ? Typeface.BOLD : Typeface.ITALIC;
                    text.setSpan(new StyleSpan(style), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
            }
        }

        TextView view = textView(text);
        view.setLineSpacing(dp(7), 1f);
        LinearLayout.LayoutParams params = matchWrap();
        params.bottomMargin = dp("heading".equals(kind) ? 14 : 12);
        if ("heading".equals(kind)) {
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSizeSp + 4);
            view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        } else if ("quote".equals(kind)) {
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSizeSp);
            view.setTypeface(Typeface.DEFAULT, Typeface.ITALIC);
            view.setPadding(dp(12), dp(4), dp(4), dp(4));
            view.setBackground(readerBlockBackground());
        } else {
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSizeSp);
        }
        container.addView(view, params);
    }

    private void addImageBlock(JSONObject block) {
        String url = block.optString("url", "");
        String altText = block.optString("altText", "");
        String caption = block.optString("caption", "");
        if (caption.isEmpty()) {
            caption = altText;
        }

        FrameLayout frame = new FrameLayout(context);
        frame.setBackground(readerBlockBackground());
        LinearLayout.LayoutParams frameParams = matchWrap();
        frameParams.bottomMargin = dp(4);

        ImageView image = new ImageView(context);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setContentDescription(altText.isEmpty() ? caption : altText);
        FrameLayout.LayoutParams imageParams = new FrameLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(360),
                Gravity.CENTER
        );
        frame.addView(image, imageParams);

        TextView placeholder = new TextView(context);
        placeholder.setGravity(Gravity.CENTER);
        placeholder.setPadding(dp(16), dp(16), dp(16), dp(16));
        placeholder.setTextColor(context.getColor(R.color.readlite_muted));
        placeholder.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        FrameLayout.LayoutParams placeholderParams = new FrameLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(360),
                Gravity.CENTER
        );
        frame.addView(placeholder, placeholderParams);
        container.addView(frame, frameParams);

        if (!url.isEmpty()) {
            StoryCoverLoader.bind(url, altText, image, placeholder, 360, 480);
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            image.setContentDescription(altText.isEmpty() ? caption : altText);
            placeholder.setBackground(readerBlockBackground());
        } else {
            placeholder.setText(altText.isEmpty() ? "Không tải được ảnh trong chương." : altText);
            image.setVisibility(View.GONE);
        }

        if (!caption.isEmpty()) {
            TextView captionView = textView(caption);
            captionView.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(12, fontSizeSp - 2));
            captionView.setTextColor(context.getColor(R.color.readlite_muted));
            captionView.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams captionParams = matchWrap();
            captionParams.bottomMargin = dp(18);
            container.addView(captionView, captionParams);
        }
    }

    private TextView textView(CharSequence text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(context.getColor(R.color.readlite_ink));
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSizeSp);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
    }

    private GradientDrawable readerBlockBackground() {
        GradientDrawable background = new GradientDrawable();
        background.setColor(context.getColor(R.color.readlite_paper));
        background.setCornerRadius(dp(8));
        background.setStroke(dp(1), context.getColor(R.color.readlite_line));
        return background;
    }

    private int dp(int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

}

