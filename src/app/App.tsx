import { useEffect, useSyncExternalStore } from 'react';
import { SiteScene } from '../render/scene/SiteScene';
import { IssueBar } from '../ui/IssueBar';
import { LanScanPopup, LeftPanel } from '../ui/LeftPanel';
import { ScanZoom } from '../ui/Barcode';
import { Pda } from '../ui/Pda';
import { Rail } from '../ui/Rail';
import { RightPanel } from '../ui/RightPanel';
import { TopBar, ViewBar } from '../ui/TopBar';
import { AppContext, type AppCtx } from './context';

/** MFC 시뮬레이터와 같은 뼈대: [왼쪽 아이콘 메뉴 | 머리줄 → [왼쪽 패널 · 3D · 오른쪽 패널]] */
export function App({ app }: { app: AppCtx }) {
  const view = app.controller;
  useSyncExternalStore(view.subscribe, view.getVersion);
  useEffect(() => {
    document.documentElement.dataset.theme = view.theme;
  }, [view.theme]);
  return (
    <AppContext.Provider value={app}>
      <div id="viewport">
        <SiteScene app={app} />
      </div>
      <div id="ui" data-left={view.leftView ? 'open' : 'closed'} data-right={view.rightView ? 'open' : 'closed'}>
        <Rail />
        <div className="shell">
          <TopBar />
          <IssueBar />
          <div className="stage">
            <LeftPanel />
            <div className="stage-gap">
              <ViewBar />
            </div>
            <RightPanel />
          </div>
          <Pda />
          <ScanZoom />
          {/* PDA 로 찍을 코드 — 어느 탭에서도 떠 있음 */}
          <LanScanPopup />
        </div>
      </div>
    </AppContext.Provider>
  );
}
