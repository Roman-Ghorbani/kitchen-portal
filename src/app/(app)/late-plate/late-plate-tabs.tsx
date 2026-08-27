'use client';

import { useState } from 'react';

export function LatePlateTabs({
  mealsTab,
  recurringTab,
  profileTab,
}: {
  mealsTab: React.ReactNode;
  recurringTab: React.ReactNode;
  profileTab: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<'meals' | 'recurring' | 'profile'>('meals');

  return (
    <div className="lp-tabs-container">
      <div className="lp-tabs-header">
        <button
          className={`lp-tab-btn ${activeTab === 'meals' ? 'active' : ''}`}
          onClick={() => setActiveTab('meals')}
        >
          🍽️ Today & Upcoming
        </button>
        <button
          className={`lp-tab-btn ${activeTab === 'recurring' ? 'active' : ''}`}
          onClick={() => setActiveTab('recurring')}
        >
          🔁 Recurring Plates
        </button>
        <button
          className={`lp-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          👤 Profile & Info
        </button>
      </div>

      <div className="lp-tab-content">
        {activeTab === 'meals' && mealsTab}
        {activeTab === 'recurring' && recurringTab}
        {activeTab === 'profile' && profileTab}
      </div>
    </div>
  );
}
