import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PublishingCenterPage from '../../src/publishing/PublishingCenterPage';
import { PublishingShowcase } from '../../src/publishing/PublishingShowcase';
import '../../src/index.css';
const showcase = new URLSearchParams(location.search).has('showcase');
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    {showcase ? (
      <>
        <section id="brokers">
          <h2>Brokers fixture anchor</h2>
        </section>
        <PublishingShowcase />
        <section id="property-search">
          <h2>Property Search fixture anchor</h2>
        </section>
      </>
    ) : (
      <Routes>
        <Route path="/publishing" element={<PublishingCenterPage />} />
        <Route
          path="/publishing/portals"
          element={<PublishingCenterPage view="portals" />}
        />
        <Route
          path="/publishing/activity"
          element={<PublishingCenterPage view="activity" />}
        />
        <Route
          path="/publishing/property/:propertyId"
          element={<PublishingCenterPage />}
        />
      </Routes>
    )}
  </BrowserRouter>,
);
