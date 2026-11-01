package com.readlite.mobile;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;

import android.app.Activity;
import android.content.Intent;

import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;

import com.google.android.material.bottomnavigation.BottomNavigationView;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Collection;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public final class MainNavigationTest {
    @Rule
    public final ActivityScenarioRule<CatalogActivity> scenarioRule =
            new ActivityScenarioRule<>(new Intent(
                    InstrumentationRegistry.getInstrumentation().getTargetContext(), CatalogActivity.class));

    @Test
    public void fourPrimaryTabsReuseCatalogAndChildBackReturnsToSelectedTab() {
        AtomicReference<CatalogActivity> originalCatalog = new AtomicReference<>();
        scenarioRule.getScenario().onActivity(activity -> {
            originalCatalog.set(activity);
            BottomNavigationView navigation =
                    activity.findViewById(R.id.catalog_bottom_navigation);
            assertEquals(4, navigation.getMenu().size());
            assertNotNull(navigation.getMenu().findItem(R.id.catalog_nav_explore));
            assertNotNull(navigation.getMenu().findItem(R.id.catalog_nav_home));
            assertNotNull(navigation.getMenu().findItem(R.id.catalog_nav_bookshelf));
            assertNotNull(navigation.getMenu().findItem(R.id.catalog_nav_account));
        });

        onView(withId(R.id.catalog_nav_home)).perform(click());
        onView(withId(R.id.home_root)).check(matches(isDisplayed()));
        UiPreviewCapture.save("home");
        onView(withId(R.id.catalog_nav_account)).perform(click());
        onView(withId(R.id.account_root)).check(matches(isDisplayed()));
        UiPreviewCapture.save("account");
        onView(withId(R.id.catalog_nav_bookshelf)).perform(click());
        onView(withId(R.id.bookshelf_root)).check(matches(isDisplayed()));
        UiPreviewCapture.save("bookshelf");
        onView(withId(R.id.catalog_nav_explore)).perform(click());
        onView(withId(R.id.catalog_root)).check(matches(isDisplayed()));
        assertSelectedTab(R.id.catalog_nav_explore);
        UiPreviewCapture.save("explore");

        Intent detail = new Intent(
                InstrumentationRegistry.getInstrumentation().getTargetContext(),
                StoryDetailActivity.class
        );
        detail.putExtra(StoryDetailActivity.EXTRA_STORY_ID, "0");
        scenarioRule.getScenario().onActivity(activity -> activity.startActivity(detail));
        onView(withId(R.id.story_detail_back_button)).perform(click());
        onView(withId(R.id.catalog_root)).check(matches(isDisplayed()));
        assertSelectedTab(R.id.catalog_nav_explore);

        Intent reader = new Intent(
                InstrumentationRegistry.getInstrumentation().getTargetContext(),
                ChapterReaderActivity.class
        );
        reader.putExtra(ChapterReaderActivity.EXTRA_STORY_ID, "0");
        reader.putExtra(ChapterReaderActivity.EXTRA_CHAPTER_ID, "0");
        scenarioRule.getScenario().onActivity(activity -> activity.startActivity(reader));
        onView(withId(R.id.chapter_reader_back_button)).perform(click());
        onView(withId(R.id.catalog_root)).check(matches(isDisplayed()));
        assertSelectedTab(R.id.catalog_nav_explore);

        AtomicReference<CatalogActivity> resumedCatalog = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            Collection<Activity> resumedActivities = ActivityLifecycleMonitorRegistry
                    .getInstance()
                    .getActivitiesInStage(Stage.RESUMED);
            for (Activity activity : resumedActivities) {
                if (activity instanceof CatalogActivity) {
                    resumedCatalog.set((CatalogActivity) activity);
                    break;
                }
            }
        });
        assertSame(originalCatalog.get(), resumedCatalog.get());
    }

    private void assertSelectedTab(int itemId) {
        onView(withId(R.id.catalog_bottom_navigation)).check((view, exception) ->
                assertEquals(itemId, ((BottomNavigationView) view).getSelectedItemId())
        );
    }
}
