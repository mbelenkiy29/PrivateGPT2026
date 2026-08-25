import React, { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { AuthProvider } from "@/AuthContext";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import i18n from "./i18n";

import { PfpProvider } from "./PfpContext";
import { LogoProvider } from "./LogoContext";
import { FullScreenLoader } from "./components/Preloader";
import { ThemeProvider } from "./ThemeContext";
import { PWAModeProvider } from "./PWAContext";
import KeyboardShortcutsHelp from "@/components/KeyboardShortcutsHelp";
import ImageLightbox from "@/components/ImageLightbox";
import { ErrorBoundary } from "react-error-boundary";
import ErrorBoundaryFallback from "./components/ErrorBoundaryFallback";
import * as Sentry from "@sentry/react";

export default function App() {
  const location = useLocation();
  return (
    <ErrorBoundary
      FallbackComponent={ErrorBoundaryFallback}
      onError={(error, info) => {
        console.error(error);
        Sentry.captureException(error, {
          extra: { componentStack: info?.componentStack },
        });
      }}
      resetKeys={[location.pathname]}
    >
      <ThemeProvider>
        <PWAModeProvider>
          <Suspense fallback={<FullScreenLoader />}>
            <AuthProvider>
              <LogoProvider>
                <PfpProvider>
                  <I18nextProvider i18n={i18n}>
                    <Outlet />
                    <ToastContainer />
                    <KeyboardShortcutsHelp />
                    <ImageLightbox />
                  </I18nextProvider>
                </PfpProvider>
              </LogoProvider>
            </AuthProvider>
          </Suspense>
        </PWAModeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
