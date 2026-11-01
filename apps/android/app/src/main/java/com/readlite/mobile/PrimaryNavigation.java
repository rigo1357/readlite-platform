package com.readlite.mobile;

import android.content.Intent;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.bottomnavigation.BottomNavigationView;

/** The same four destinations on every primary screen. */
public final class PrimaryNavigation {
    private PrimaryNavigation() { }

    public static void bind(AppCompatActivity activity, int navigationId, int selectedId) {
        BottomNavigationView navigation = activity.findViewById(navigationId);
        // The screen root already reserves the system navigation area.
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(navigation,
                (view, insets) -> androidx.core.view.WindowInsetsCompat.CONSUMED);
        navigation.setSelectedItemId(selectedId);
        navigation.setOnItemSelectedListener(item -> {
            if (item.getItemId() == selectedId) return true;
            Class<?> destination;
            if (item.getItemId() == R.id.catalog_nav_home) destination = HomeActivity.class;
            else if (item.getItemId() == R.id.catalog_nav_explore) destination = CatalogActivity.class;
            else if (item.getItemId() == R.id.catalog_nav_bookshelf) destination = BookshelfActivity.class;
            else destination = AccountActivity.class;
            Intent intent = new Intent(activity, destination);
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            activity.startActivity(intent);
            // Keep the source tab selected when the user returns with Android Back.
            return false;
        });
    }
}
