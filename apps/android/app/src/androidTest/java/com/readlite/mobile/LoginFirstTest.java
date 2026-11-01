package com.readlite.mobile;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.action.ViewActions.scrollTo;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static org.junit.Assert.*;

import android.content.Context;
import android.content.Intent;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class LoginFirstTest {
    @Test public void launcherOpensLoginAndRegistrationCanReturnToLogin() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent launcher = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        assertNotNull(launcher);
        assertEquals(MainActivity.class.getName(), launcher.getComponent().getClassName());
        boolean previousTheme = ThemeManager.isDarkTheme(context);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> ThemeManager.setDarkTheme(context, false));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(launcher)) {
            onView(withId(R.id.auth_title)).check(matches(withText(R.string.auth_title_login)));
            onView(withId(R.id.register_fields)).check(matches(withEffectiveVisibility(Visibility.GONE)));
            UiPreviewCapture.save("login-light");
            onView(withId(R.id.submit_auth_button)).perform(scrollTo(), click());
            onView(withId(R.id.connection_status)).check(matches(withText(R.string.auth_required_fields)));
            onView(withId(R.id.register_mode_button)).perform(scrollTo(), click());
            onView(withId(R.id.auth_title)).check(matches(withText(R.string.auth_title_register)));
            onView(withId(R.id.register_fields)).check(matches(withEffectiveVisibility(Visibility.VISIBLE)));
            onView(withId(R.id.auth_title)).perform(scrollTo());
            UiPreviewCapture.save("register-light");
            onView(withId(R.id.auth_back_button)).perform(scrollTo(), click());
            onView(withId(R.id.auth_title)).check(matches(withText(R.string.auth_title_login)));
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> ThemeManager.setDarkTheme(context, previousTheme));
        }
    }
}
