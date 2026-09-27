/* ══════════════════════════════════════════════════════════════════════════
   purchase3way.js — HC(유통) "구매 3-way match" 탭 (2026-09-27, 대형 로드맵 라운드6-A)
   발주(PO) → 입고(GR, 기존 p3_purchase_docs 재사용) → 매입송장(Invoice) 3단계 대사.
   서버 쪽은 inthub/round6_3way_inta_c3_migration.sql. 근거: claude/모듈_라운드6_구매3way_원료역추적_C3.md

   서브탭 4개: 발주(po) / 입고 등록(gr) / 매입송장(invoice) / 3-way match 리포트(match)
   gr/invoice/match 3개 서브탭은 "발주(PO) 선택"에 종속된다(상단 공통 선택바).

   ⚠️ 입고(GR)는 draft로만 생성한다 — 실제 확정(재고 반영)은 기존 "입고전표" 탭의
   확정 버튼을 그대로 써야 한다(기존 확정 RPC 무수정 원칙, 중복 UI 없음).

   사용법:
     <script src="./js/purchase3way.js"></script>
     Purchase3Way.init({ sb, username: myUsername, pw: myPw, isAdmin, onChange: loadAll });
     탭 전환 시: el.innerHTML = '<div id="p3wRoot"></div>'; Purchase3Way.render();
══════════════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    const SUBS = [
        ['po', '📝 발주(PO)'],
        ['gr', '📥 입고 등록(발주 기준)'],
        ['invoice', '🧾 매입송장'],
        ['match', '🔍 3-way match 리포트'],
    ];
    const MATCH_LABEL = {
        matched: ['badge-ok', '완전일치'], partial: ['badge-warn', '부분입고/청구'],
        no_receipt: ['badge-dim', '입고 없음'], no_invoice: ['badge-dim', '송장 없음'],
        over_invoiced: ['badge-danger', '과다청구'], price_mismatch: ['badge-danger', '단가불일치'],
    };
    const PO_STATUS_LABEL = { draft: ['badge-dim', '임시저장'], confirmed: ['badge-ok', '확정'], closed: ['badge-info', '종료'], canceled: ['badge-danger', '취소'] };
    const INV_STATUS_LABEL = { draft: ['badge-dim', '임시저장'], confirmed: ['badge-ok', '확정'], disputed: ['badge-warn', '이의제기'], canceled: ['badge-danger', '취소'] };

    const S = {
        cfg: null, sub: 'po', msg: null,
        items: [], partners: [], warehouses: [],
        pos: [], poId: '',
        invoices: [], matchRows: [],
        poLines: [], // PO 작성 중인 임시 줄 목록
        f: {
            poPartner: '', poNote: '', lineItem: '', lineQty: '', lineUnitPrice: '',
            grPoLineId: '', grWarehouse: '', grQty: '', grMfgDate: '', grExpiryDate: '',
            grOrigin: '', grCustomsStatus: 'cleared', grTradeType: 'domestic', grCustomsDeclNo: '', grNote: '',
            invPoLineId: '', invQty: '', invUnitPrice: '', invNo: '', invDate: '', invNote: '',
        },
    };

    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function num(n) { if (n == null || n === '') return '-'; const v = Number(n); return isNaN(v) ? '-' : v.toLocaleString('ko-KR'); }
    function dt(iso) {
        if (!iso) return '-';
        const d = new Date(iso); if (isNaN(d)) return esc(iso);
        const p = x => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    function root() { return document.getElementById('p3wRoot'); }
    function setMsg(text, ok) { S.msg = text ? { text, ok: !!ok } : null; }
    function v(id) { const e = document.getElementById(id); return e ? e.value : ''; }

    async function call(fn, args, admin) {
        const c = S.cfg;
        if (!c.sb) throw new Error('Supabase 연결이 설정되지 않았습니다');
        const payload = admin ? Object.assign({ p_admin_username: c.username, p_admin_password: c.pw }, args || {}) : (args || {});
        const { data, error } = await c.sb.rpc(fn, payload);
        if (error) throw new Error(error.message || String(error));
        return data;
    }
    async function adminAction(fn, args, okText) {
        try {
            const r = await call(fn, args, true);
            if (r && r.success === false) { setMsg(r.message || '처리 실패', false); }
            else { setMsg(okText(r || {}), true); if (typeof S.cfg.onChange === 'function') { try { await S.cfg.onChange(); } catch (e) {} } }
            return r;
        } catch (e) { setMsg('오류: ' + e.message, false); return null; }
    }

    function currentPo() { return S.pos.find(p => p.id === S.poId) || null; }
    function itemLabel(id) { const it = S.items.find(i => i.id === id); return it ? `${it.item_code} · ${it.item_name}` : id; }

    async function loadOnce() {
        if (!S.items.length) S.items = await call('p3_get_items') || [];
        if (!S.partners.length) S.partners = await call('p3_get_partners') || [];
        if (!S.warehouses.length) S.warehouses = await call('p3_get_warehouses') || [];
    }
    async function loadPos() { S.pos = await call('p3_get_purchase_orders') || []; }
    async function loadPoDependents() {
        S.invoices = S.poId ? (await call('p3_get_purchase_invoices', { p_po_id: S.poId }) || []) : [];
        S.matchRows = S.poId ? (await call('p3_get_3way_match', { p_po_id: S.poId }) || []) : [];
    }

    let _renderToken = 0;
    async function render() {
        const my = ++_renderToken;
        const el = root(); if (!el) return;
        if (!el.innerHTML.trim()) el.innerHTML = '<div class="empty-state">불러오는 중...</div>';
        try {
            await loadOnce();
            if (!S.pos.length) await loadPos();
            if (S.poId && S.sub !== 'po') await loadPoDependents();
            if (my !== _renderToken) return;
            draw();
        } catch (e) {
            el.innerHTML = `<div class="card"><div class="empty-state">구매 3-way match 데이터를 불러오지 못했습니다: ${esc(e.message)}<br><span style="font-size:11.5px">Supabase SQL Editor에서 <code>round6_3way_inta_c3_migration.sql</code>을 먼저 실행했는지 확인하세요.</span></div></div>`;
        }
    }

    // ── 상단 공통 PO 선택바 — po 서브탭 제외 ─────────────────────────────
    function poPickerHTML() {
        const opts = ['<option value="">발주를 선택하세요</option>'].concat(
            S.pos.map(p => `<option value="${esc(p.id)}" ${S.poId === p.id ? 'selected' : ''}>${esc(p.doc_no)} · ${esc(p.partner_name || '-')} (${PO_STATUS_LABEL[p.status] ? PO_STATUS_LABEL[p.status][1] : p.status})</option>`)
        ).join('');
        return `<div class="card"><div class="card-title">발주(PO) 선택</div><select id="p3wPoPick" class="form-select" style="width:auto;min-width:320px;" data-act="pick-po">${opts}</select></div>`;
    }

    // ── 1) 발주(po) ───────────────────────────────────────────────────────
    function poLinesEditorHTML() {
        const rows = S.poLines.map((l, i) => `
            <tr>
                <td>${esc(itemLabel(l.item_id))}</td><td class="num">${num(l.qty)}</td><td class="num">${num(l.unit_price)}</td>
                <td><button type="button" class="line-remove" data-act="remove-po-line" data-idx="${i}">삭제</button></td>
            </tr>`).join('');
        const itemOpts = ['<option value="">품목 선택</option>'].concat(S.items.map(i => `<option value="${esc(i.id)}" ${S.f.lineItem === i.id ? 'selected' : ''}>${esc(i.item_code)} · ${esc(i.item_name)}</option>`)).join('');
        return `
            <div class="card">
                <div class="card-title">새 발주 작성</div>
                <div class="form-grid">
                    <div><label class="form-label">거래처(매입처) *</label><select id="p3wPoPartner" class="form-select">
                        <option value="">선택</option>
                        ${S.partners.filter(p => p.partner_type !== 'customer').map(p => `<option value="${esc(p.id)}" ${S.f.poPartner === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                    </select></div>
                    <div class="full"><label class="form-label">비고</label><input id="p3wPoNote" class="form-input" value="${esc(S.f.poNote)}"></div>
                </div>
                <table class="line-table">
                    <thead><tr><th>품목</th><th>수량</th><th>단가</th><th></th></tr></thead>
                    <tbody>${rows || ''}</tbody>
                </table>
                <div class="form-grid">
                    <div><select id="p3wLineItem" class="form-select">${itemOpts}</select></div>
                    <div><input id="p3wLineQty" type="number" min="0" step="any" class="form-input" placeholder="수량"></div>
                    <div><input id="p3wLineUnitPrice" type="number" min="0" step="any" class="form-input" placeholder="단가"></div>
                    <div><button type="button" class="btn btn-secondary" data-act="add-po-line">줄 추가</button></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-po">발주 저장(임시저장)</button></div>
            </div>`;
    }
    function poHTML() {
        const rows = S.pos.length ? S.pos.map(p => `<tr class="${p.id === S.poId ? 'so-open' : ''}">
            <td>${esc(p.doc_no)}</td><td>${esc(p.partner_name || '-')}</td>
            <td>${p.lines.length}개 품목 / ${num(p.lines.reduce((s, l) => s + l.qty * l.unit_price, 0))}원</td>
            <td><span class="badge ${PO_STATUS_LABEL[p.status] ? PO_STATUS_LABEL[p.status][0] : 'badge-dim'}">${PO_STATUS_LABEL[p.status] ? PO_STATUS_LABEL[p.status][1] : p.status}</span></td>
            <td>${dt(p.created_at)}</td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-small" data-act="select-po" data-id="${esc(p.id)}">선택</button>
                ${p.status === 'draft' ? `<button type="button" class="btn btn-primary btn-small" data-act="confirm-po" data-id="${esc(p.id)}">확정</button>` : ''}
                ${(p.status === 'draft' || p.status === 'confirmed') ? `<button type="button" class="btn btn-danger btn-small" data-act="cancel-po" data-id="${esc(p.id)}">취소</button>` : ''}
            </td>
        </tr>`).join('') : '<tr><td colspan="6" class="empty-state">등록된 발주가 없습니다</td></tr>';
        return `<div class="card"><div class="card-title">발주 목록(${S.pos.length}건)</div>
            <div class="table-responsive"><table>
                <thead><tr><th>발주번호</th><th>매입처</th><th>내역</th><th>상태</th><th>작성일시</th><th>동작</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div></div>${poLinesEditorHTML()}`;
    }

    // ── 2) 입고 등록(gr) ─────────────────────────────────────────────────
    function grHTML() {
        const po = currentPo();
        if (!po) return '<div class="empty-state">발주를 먼저 선택하세요.</div>';
        if (po.status !== 'confirmed') return `<div class="empty-state">확정(confirmed) 상태의 발주에만 입고를 등록할 수 있습니다 — 현재 상태: ${PO_STATUS_LABEL[po.status] ? PO_STATUS_LABEL[po.status][1] : po.status}</div>`;
        const lineOpts = ['<option value="">발주 줄 선택</option>'].concat(
            po.lines.map(l => `<option value="${esc(l.id)}" ${S.f.grPoLineId === l.id ? 'selected' : ''}>${esc(l.item_code)} · ${esc(l.item_name)} (발주수량 ${num(l.qty)})</option>`)
        ).join('');
        const whOpts = S.warehouses.map(w => `<option value="${esc(w.id)}" ${S.f.grWarehouse === w.id ? 'selected' : ''}>${esc(w.warehouse_name)}</option>`).join('');
        return `
            <div class="note-card">이 화면은 발주를 참조하는 <b>draft 입고전표</b>만 생성합니다 — 발주 잔량을 초과할 수 없습니다. 생성 후에는 기존 "입고전표" 탭에서 확인하고 그 탭의 확정 버튼으로 확정해야 실제 재고(Lot)에 반영됩니다.</div>
            <div class="card">
                <div class="card-title">발주 기준 입고 등록 (1줄씩 등록)</div>
                <div class="form-grid">
                    <div><label class="form-label">발주 줄 *</label><select id="p3wGrLine" class="form-select">${lineOpts}</select></div>
                    <div><label class="form-label">입고 수량 *</label><input id="p3wGrQty" type="number" min="0" step="any" class="form-input" value="${esc(S.f.grQty)}"></div>
                    <div><label class="form-label">입고 창고 *</label><select id="p3wGrWarehouse" class="form-select"><option value="">선택</option>${whOpts}</select></div>
                    <div><label class="form-label">거래유형</label><select id="p3wGrTradeType" class="form-select">
                        <option value="domestic" ${S.f.grTradeType === 'domestic' ? 'selected' : ''}>국내</option>
                        <option value="import" ${S.f.grTradeType === 'import' ? 'selected' : ''}>수입</option>
                    </select></div>
                    <div><label class="form-label">제조일자</label><input id="p3wGrMfgDate" type="date" class="form-input" value="${esc(S.f.grMfgDate)}"></div>
                    <div><label class="form-label">유효기한</label><input id="p3wGrExpiryDate" type="date" class="form-input" value="${esc(S.f.grExpiryDate)}"></div>
                    <div><label class="form-label">원산지</label><input id="p3wGrOrigin" class="form-input" value="${esc(S.f.grOrigin)}"></div>
                    <div><label class="form-label">통관상태</label><select id="p3wGrCustomsStatus" class="form-select">
                        <option value="cleared" ${S.f.grCustomsStatus === 'cleared' ? 'selected' : ''}>통관완료</option>
                        <option value="pending" ${S.f.grCustomsStatus === 'pending' ? 'selected' : ''}>통관대기</option>
                    </select></div>
                    <div><label class="form-label">수입신고번호</label><input id="p3wGrCustomsDeclNo" class="form-input" value="${esc(S.f.grCustomsDeclNo)}"></div>
                    <div class="full"><label class="form-label">비고</label><input id="p3wGrNote" class="form-input" value="${esc(S.f.grNote)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-gr">입고전표(draft) 생성</button></div>
            </div>`;
    }

    // ── 3) 매입송장(invoice) ─────────────────────────────────────────────
    function invoiceHTML() {
        const po = currentPo();
        if (!po) return '<div class="empty-state">발주를 먼저 선택하세요.</div>';
        const lineOpts = ['<option value="">발주 줄 선택</option>'].concat(
            po.lines.map(l => `<option value="${esc(l.id)}" ${S.f.invPoLineId === l.id ? 'selected' : ''}>${esc(l.item_code)} · ${esc(l.item_name)} (발주단가 ${num(l.unit_price)})</option>`)
        ).join('');
        const rows = S.invoices.length ? S.invoices.map(inv => `<tr>
            <td>${esc(inv.doc_no)}</td><td>${esc(inv.invoice_no || '-')}</td><td>${esc(inv.invoice_date || '-')}</td>
            <td>${inv.lines.length}개 / ${num(inv.lines.reduce((s, l) => s + l.qty * l.unit_price, 0))}원</td>
            <td><span class="badge ${INV_STATUS_LABEL[inv.status] ? INV_STATUS_LABEL[inv.status][0] : 'badge-dim'}">${INV_STATUS_LABEL[inv.status] ? INV_STATUS_LABEL[inv.status][1] : inv.status}</span></td>
            <td class="row-actions">
                ${inv.status === 'draft' ? `<button type="button" class="btn btn-primary btn-small" data-act="inv-status" data-id="${esc(inv.id)}" data-to="confirmed">확정</button>` : ''}
                ${inv.status === 'confirmed' ? `<button type="button" class="btn btn-secondary btn-small" data-act="inv-status" data-id="${esc(inv.id)}" data-to="disputed">이의제기</button>` : ''}
                ${inv.status !== 'canceled' ? `<button type="button" class="btn btn-danger btn-small" data-act="inv-status" data-id="${esc(inv.id)}" data-to="canceled">취소</button>` : ''}
            </td>
        </tr>`).join('') : '<tr><td colspan="6" class="empty-state">등록된 매입송장이 없습니다</td></tr>';
        return `
            <div class="card"><div class="card-title">매입송장 목록(${S.invoices.length}건)</div>
                <div class="table-responsive"><table>
                    <thead><tr><th>내부번호</th><th>공급처 송장번호</th><th>송장일자</th><th>내역</th><th>상태</th><th>동작</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table></div>
            </div>
            <div class="card">
                <div class="card-title">매입송장 등록 (1줄씩 등록)</div>
                <div class="form-grid">
                    <div><label class="form-label">발주 줄 *</label><select id="p3wInvLine" class="form-select">${lineOpts}</select></div>
                    <div><label class="form-label">청구 수량 *</label><input id="p3wInvQty" type="number" min="0" step="any" class="form-input" value="${esc(S.f.invQty)}"></div>
                    <div><label class="form-label">청구 단가 *</label><input id="p3wInvUnitPrice" type="number" min="0" step="any" class="form-input" value="${esc(S.f.invUnitPrice)}"></div>
                    <div><label class="form-label">공급처 송장번호</label><input id="p3wInvNo" class="form-input" value="${esc(S.f.invNo)}"></div>
                    <div><label class="form-label">송장일자</label><input id="p3wInvDate" type="date" class="form-input" value="${esc(S.f.invDate)}"></div>
                    <div class="full"><label class="form-label">비고</label><input id="p3wInvNote" class="form-input" value="${esc(S.f.invNote)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-invoice">매입송장 등록</button></div>
            </div>`;
    }

    // ── 4) 3-way match 리포트(match) ─────────────────────────────────────
    function matchHTML() {
        const po = currentPo();
        if (!po) return '<div class="empty-state">발주를 먼저 선택하세요.</div>';
        const rows = S.matchRows.length ? S.matchRows.map(r => `<tr>
            <td>${esc(r.item_code)} · ${esc(r.item_name)}</td>
            <td class="num">${num(r.ordered_qty)}</td><td class="num">${num(r.ordered_unit_price)}</td>
            <td class="num">${num(r.received_qty)}</td>
            <td class="num">${num(r.invoiced_qty)}</td>
            <td class="num">${r.avg_invoice_unit_price == null ? '-' : num(r.avg_invoice_unit_price)}</td>
            <td><span class="badge ${MATCH_LABEL[r.match_status] ? MATCH_LABEL[r.match_status][0] : 'badge-dim'}">${MATCH_LABEL[r.match_status] ? MATCH_LABEL[r.match_status][1] : r.match_status}</span></td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty-state">데이터 없음</td></tr>';
        return `<div class="card">
            <div class="card-title">3-way match — ${esc(po.doc_no)}</div>
            <p class="so-help">입고·송장 수량은 <b>확정(confirmed)</b>된 것만 집계합니다. 단가불일치는 송장 가중평균단가가 발주단가와 0.01 이상 차이날 때 표시됩니다.</p>
            <div class="table-responsive"><table>
                <thead><tr><th>품목</th><th>발주수량</th><th>발주단가</th><th>입고수량(확정)</th><th>청구수량(확정)</th><th>청구 평균단가</th><th>판정</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
        </div>`;
    }

    function draw() {
        const el = root(); if (!el) return;
        const msgHtml = S.msg ? `<div class="so-msg ${S.msg.ok ? 'ok' : 'err'}">${esc(S.msg.text)}</div>` : '';
        const subsBar = `<div class="so-subtabs">${SUBS.map(([k, l]) => `<button type="button" class="so-subtab ${S.sub === k ? 'active' : ''}" data-act="sub" data-k="${k}">${l}</button>`).join('')}</div>`;
        const picker = S.sub === 'po' ? '' : poPickerHTML();
        let body = '';
        if (S.sub === 'po') body = poHTML();
        else if (S.sub === 'gr') body = grHTML();
        else if (S.sub === 'invoice') body = invoiceHTML();
        else if (S.sub === 'match') body = matchHTML();
        el.innerHTML = subsBar + msgHtml + picker + body;
    }

    async function onClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (!b || !root() || !root().contains(b)) return;
        const act = b.dataset.act, id = b.dataset.id;

        if (act === 'sub') { S.sub = b.dataset.k; setMsg(null); draw(); return; }
        if (act === 'select-po') { S.poId = id; await loadPoDependents(); draw(); return; }

        if (act === 'add-po-line') {
            const itemId = v('p3wLineItem'), qty = v('p3wLineQty'), price = v('p3wLineUnitPrice');
            if (!itemId || !qty) { setMsg('품목과 수량을 입력하세요', false); draw(); return; }
            S.poLines.push({ item_id: itemId, qty: Number(qty), unit_price: Number(price || 0) });
            draw(); return;
        }
        if (act === 'remove-po-line') { S.poLines.splice(Number(b.dataset.idx), 1); draw(); return; }
        if (act === 'save-po') {
            if (!v('p3wPoPartner')) { setMsg('매입처를 선택하세요', false); draw(); return; }
            if (!S.poLines.length) { setMsg('품목을 1개 이상 추가하세요', false); draw(); return; }
            const r = await adminAction('p3_admin_create_purchase_order', { p_partner_id: v('p3wPoPartner'), p_note: v('p3wPoNote') || null, p_lines: S.poLines }, r => `발주 ${r.doc_no} 저장되었습니다(임시저장)`);
            if (r && r.success) { S.poLines = []; S.f.poPartner = ''; S.f.poNote = ''; }
            await loadPos(); draw(); return;
        }
        if (act === 'confirm-po') { await adminAction('p3_admin_confirm_purchase_order', { p_po_id: id }, () => '발주를 확정했습니다'); await loadPos(); draw(); return; }
        if (act === 'cancel-po') {
            const reason = prompt('취소 사유를 입력하세요(선택):', '') || '';
            await adminAction('p3_admin_cancel_purchase_order', { p_po_id: id, p_reason: reason }, () => '발주를 취소했습니다');
            await loadPos(); draw(); return;
        }

        if (act === 'save-gr') {
            const lineId = v('p3wGrLine'), qty = v('p3wGrQty'), wh = v('p3wGrWarehouse');
            if (!lineId || !qty || !wh) { setMsg('발주 줄·수량·창고를 입력하세요', false); draw(); return; }
            const r = await adminAction('p3_admin_create_purchase_doc_from_po', {
                p_po_id: S.poId, p_warehouse_id: wh, p_trade_type: v('p3wGrTradeType'),
                p_customs_declaration_no: v('p3wGrCustomsDeclNo') || null, p_note: v('p3wGrNote') || null,
                p_lines: [{ po_line_id: lineId, qty: Number(qty), mfg_date: v('p3wGrMfgDate') || null, expiry_date: v('p3wGrExpiryDate') || null, origin_country: v('p3wGrOrigin') || null, customs_status: v('p3wGrCustomsStatus') }],
            }, r => `입고전표 ${r.doc_no}(draft)가 생성되었습니다 — "입고전표" 탭에서 확정하세요`);
            if (r && r.success) { S.f.grQty = ''; S.f.grMfgDate = ''; S.f.grExpiryDate = ''; S.f.grOrigin = ''; S.f.grCustomsDeclNo = ''; S.f.grNote = ''; }
            draw(); return;
        }

        if (act === 'save-invoice') {
            const lineId = v('p3wInvLine'), qty = v('p3wInvQty'), price = v('p3wInvUnitPrice');
            if (!lineId || !qty) { setMsg('발주 줄·청구수량을 입력하세요', false); draw(); return; }
            const r = await adminAction('p3_admin_create_purchase_invoice', {
                p_po_id: S.poId, p_invoice_no: v('p3wInvNo') || null, p_invoice_date: v('p3wInvDate') || null, p_note: v('p3wInvNote') || null,
                p_lines: [{ po_line_id: lineId, qty: Number(qty), unit_price: Number(price || 0) }],
            }, r => `매입송장 ${r.doc_no}가 등록되었습니다`);
            if (r && r.success) { S.f.invQty = ''; S.f.invUnitPrice = ''; S.f.invNo = ''; S.f.invDate = ''; S.f.invNote = ''; }
            await loadPoDependents(); draw(); return;
        }
        if (act === 'inv-status') {
            const reason = (b.dataset.to === 'canceled' || b.dataset.to === 'disputed') ? (prompt('사유를 입력하세요(선택):', '') || '') : '';
            await adminAction('p3_admin_set_invoice_status', { p_invoice_id: id, p_new_status: b.dataset.to, p_note: reason || null }, () => '송장 상태를 변경했습니다');
            await loadPoDependents(); draw(); return;
        }
    }

    async function onChangeEv(ev) {
        const t = ev.target; if (!root() || !root().contains(t)) return;
        if (t.dataset && t.dataset.act === 'pick-po') { S.poId = t.value; await loadPoDependents(); draw(); return; }
    }

    const CSS = `
        #p3wRoot .so-subtabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
        #p3wRoot .so-subtab{border:1px solid var(--border);background:#fff;color:var(--text-secondary);border-radius:18px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer}
        #p3wRoot .so-subtab.active{background:var(--primary);border-color:var(--primary);color:#fff}
        #p3wRoot .so-help{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:6px 0 4px}
        #p3wRoot .so-msg{padding:9px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px}
        #p3wRoot .so-msg.ok{background:var(--success-soft);color:var(--success)}
        #p3wRoot .so-msg.err{background:var(--danger-soft);color:var(--danger)}
        #p3wRoot .so-open{background:var(--info-soft)}`;

    function init(cfg) {
        S.cfg = cfg;
        if (!document.getElementById('p3wStyle')) {
            const st = document.createElement('style'); st.id = 'p3wStyle'; st.textContent = CSS; document.head.appendChild(st);
        }
        if (!S._bound) {
            document.addEventListener('click', onClick);
            document.addEventListener('change', onChangeEv);
            S._bound = true;
        }
    }

    global.Purchase3Way = { init, render };
})(window);
