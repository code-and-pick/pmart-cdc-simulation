// 이상 알림 줄(MFC ui/IssueBar 와 같은 모양) — 평소 "이상 없음 — 지금 확인할 일이 없어요", 있으면 카드. 누르면 그 화면으로 [사용자 §6-2].
import { useState } from 'react';
import { useApp, useTick, useView } from '../app/context';
import { collectIssues, ISSUES, type Issue } from '../sim/issues';

export function IssueBar() {
  const { sim, backend } = useApp();
  const view = useView();
  useTick();
  const [open, setOpen] = useState(false);
  const issues = collectIssues(sim, backend);
  if (!issues.length) return <div className="ib ib-ok">● 이상 없음 — 지금 확인할 일이 없어요</div>;
  const bad = issues.filter((i) => i.level === 'bad').length;
  const warn = issues.length - bad;
  const shown = open ? issues : issues.slice(0, ISSUES.shown);
  const go = (i: Issue) => {
    if (!i.go) return;
    if (i.go.floor !== undefined) view.setFloor(i.go.floor);
    if (i.go.right && view.rightView !== i.go.right) view.toggleRight(i.go.right);
    if (i.go.left && view.leftView !== i.go.left) view.toggleLeft(i.go.left);
  };
  return (
    <div className={`ib ${bad ? 'ib-bad' : 'ib-warn'}`} role="alert">
      <div className="ib-head">
        <span className="ib-icon" aria-hidden>
          !
        </span>
        <div className="ib-count">
          <b>확인할 일 {issues.length}건</b>
          <span>
            {bad > 0 && <em className="bad">심각 {bad}</em>}
            {warn > 0 && <em className="warn">주의 {warn}</em>}
          </span>
        </div>
      </div>
      <ul className="ib-cards">
        {shown.map((i) => (
          <li key={i.key}>
            <button className={`ib-card ${i.level}`} onClick={() => go(i)} disabled={!i.go} title={i.go ? '눌러서 보기' : undefined}>
              <span className="ib-card-1">
                <span aria-hidden>{i.icon}</span> {i.title}
              </span>
              <span className="ib-card-2">{i.what}</span>
            </button>
          </li>
        ))}
      </ul>
      {issues.length > ISSUES.shown && (
        <button className="ib-more" onClick={() => setOpen(!open)}>
          {open ? '접기' : `${issues.length - ISSUES.shown}건 더`}
        </button>
      )}
    </div>
  );
}
