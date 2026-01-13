/*
  DoseCheck - app.js
  PWA offline-first, SPA simples (hash routing), sem frameworks e sem bibliotecas externas.

  Principais recursos:
  - Armazenamento local via IndexedDB (CRUD: aplicações, pesos, medidas, configurações)
  - Dashboard com próxima aplicação, variação de peso (7/14/30) e linha do tempo consolidada
  - Rodízio automático do local de aplicação (sugestão)
  - Exportação (JSON + CSV), backup/restore por arquivo JSON
  - Insights IA: resumo de 30 dias + createAiPrompt(summary) + chamada /api/analyze (fallback mock)
  - UX: confirmação após salvar (toast), editar/excluir
*/

(() => {
  'use strict';

  // -----------------------------
  // Constantes e utilitários
  // -----------------------------

  // Mantido como 'pesomed-db' para preservar dados existentes após o rename.
  const DB_NAME = 'pesomed-db';
  const DB_VERSION = 1;

  const STORE_INJECTIONS = 'injections';
  const STORE_WEIGHTS = 'weights';
  const STORE_MEASURES = 'measures';
  const STORE_SETTINGS = 'settings';

  const SETTINGS_KEY = 'app';

  const DEFAULTS = {
    reminderDow: '', // 0-6 ou ''
    reminderTime: '19:00',

    // Checklist & Alertas (agenda fixa)
    // 0 = domingo ... 6 = sábado
    injectionDayOfWeek: 6, // sábado
    injectionTime: '09:51',
    weighDaysOfWeek: [1, 3, 5], // seg/qua/sex
    measureReminderEveryDays: 14,

    // V3: Config do paciente / relatório
    patientName: '',
    patientBirthYear: '',
    preferredReportRangeDays: 90,

    // V2: Rodízio
    enableArmSites: false
  };

  const ROTATION_SITES_DEFAULT = [
    'abdomen_right',
    'abdomen_left',
    'thigh_right',
    'thigh_left',
    'arm_right',
    'arm_left'
  ];

  const SITE_LABELS = {
    abdomen_right: 'Abdômen (direito)',
    abdomen_left: 'Abdômen (esquerdo)',
    thigh_right: 'Coxa (direita)',
    thigh_left: 'Coxa (esquerda)',
    arm_right: 'Braço (direito)',
    arm_left: 'Braço (esquerdo)'
  };

  const SYMPTOMS_LABELS = {
    nausea: 'Enjoo',
    reflux: 'Azia',
    appetite: 'Apetite',
    energy: 'Energia',
    bowel: 'Intestino'
  };

  function clampNumber(value, min, max) {
    const n = Number(value);
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  // -----------------------------
  // Consistência semanal + streak (V2)
  // -----------------------------

  function countStreakWeights(cache, settings, maxLookbackDays = 120) {
    const weighDows = new Set(settings.weighDaysOfWeek || DEFAULTS.weighDaysOfWeek);
    let d = startOfDay(now());
    let streak = 0;
    let checked = 0;

    while (checked < maxLookbackDays) {
      if (weighDows.has(d.getDay())) {
        const key = getLocalDateKey(d);
        if (cache.weightKeys.has(key)) streak += 1;
        else break;
      }
      d = addDays(d, -1);
      checked += 1;
    }
    return streak;
  }

  function countStreakInjections(cache, settings, maxWeeks = 52) {
    const injDow = clampNumber(settings.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6);
    const thisWeekStart = startOfWeekMonday(now());
    let streak = 0;

    for (let i = 0; i < maxWeeks; i++) {
      const weekStart = addDays(thisWeekStart, -7 * i);
      // achar o dia da semana dentro do bloco seg-dom
      let candidate = null;
      for (let j = 0; j < 7; j++) {
        const d = addDays(weekStart, j);
        if (d.getDay() === injDow) {
          candidate = d;
          break;
        }
      }
      if (!candidate) break;
      const key = getLocalDateKey(candidate);
      if (cache.injectionKeys.has(key)) streak += 1;
      else break;
    }

    return streak;
  }

  async function renderWeeklyConsistency(cache, settings, weekOffset = 0) {
    if (!weeklyConsistencyValue || !weeklyConsistencyMeta || !weeklyConsistencyBadge) return;

    const offset = Math.max(0, Math.floor(Number(weekOffset) || 0));
    const base = startOfWeekMonday(now());
    const start = addDays(base, -7 * offset);
    const weighDows = new Set(settings.weighDaysOfWeek || DEFAULTS.weighDaysOfWeek);

    const expectedWeighKeys = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (weighDows.has(d.getDay())) expectedWeighKeys.push(getLocalDateKey(d));
    }

    const injDow = clampNumber(settings.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6);
    let injKey = null;
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (d.getDay() === injDow) {
        injKey = getLocalDateKey(d);
        break;
      }
    }

    const expectedWeights = expectedWeighKeys.length;
    const doneWeights = expectedWeighKeys.filter((k) => cache.weightKeys.has(k)).length;
    const expectedInj = injKey ? 1 : 0;
    const doneInj = injKey && cache.injectionKeys.has(injKey) ? 1 : 0;

    const expectedPoints = expectedWeights + (expectedInj ? 2 : 0);
    const donePoints = doneWeights + (doneInj ? 2 : 0);
    const pct = expectedPoints ? Math.round((donePoints / expectedPoints) * 100) : 0;

    const badge = statusBadgeFromPercent(pct);
    weeklyConsistencyBadge.className = badge.cls;
    weeklyConsistencyBadge.textContent = badge.label;
    weeklyConsistencyValue.textContent = `${pct}%`;
    weeklyConsistencyMeta.textContent = `${formatWeekRangeLabel(start)} • Pesagens ${doneWeights}/${expectedWeights} • Aplicação ${doneInj}/${expectedInj || 1}`;
    if (weeklyConsistencyHint) weeklyConsistencyHint.textContent = 'Pontuação: pesagens (1) + aplicação (2) = 5 pontos.';
    if (streakWeightsEl) streakWeightsEl.textContent = `Streak pesagens: ${countStreakWeights(cache, settings)} dia(s)`;
    if (streakInjectionsEl) streakInjectionsEl.textContent = `Streak aplicações: ${countStreakInjections(cache, settings)} semana(s)`;
  }

  // -----------------------------
  // Gráfico de peso (Canvas) - V3
  // -----------------------------

  const chartState = {
    rangeDays: 30,
    points: [],
    weightsDesc: null
  };

  function setChartRangeButtons(rangeDays) {
    weightChartRange30Btn?.setAttribute('aria-pressed', rangeDays === 30 ? 'true' : 'false');
    weightChartRange90Btn?.setAttribute('aria-pressed', rangeDays === 90 ? 'true' : 'false');
  }

  function getCanvasSize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      cssWidth: Math.max(1, rect.width),
      cssHeight: Math.max(1, rect.height),
      width: Math.max(1, Math.floor(rect.width * dpr)),
      height: Math.max(1, Math.floor(rect.height * dpr)),
      dpr
    };
  }

  function drawWeightChart(canvas, weightsDesc, rangeDays) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = getCanvasSize(canvas);
    canvas.width = size.width;
    canvas.height = size.height;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);

    const padding = { l: 34, r: 10, t: 10, b: 22 };
    const w = size.cssWidth;
    const h = size.cssHeight;
    ctx.clearRect(0, 0, w, h);

    const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    const pointsRaw = weightsDesc
      .map((x) => ({ t: new Date(x.dateTimeISO), y: x.weightKg }))
      .filter((p) => p.t >= cutoff && Number.isFinite(p.y))
      .sort((a, b) => a.t - b.t);

    if (!pointsRaw.length) {
      ctx.fillStyle = 'rgba(234,242,255,.85)';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText('Sem dados no período.', 12, 22);
      chartState.points = [];
      return;
    }

    const minT = pointsRaw[0].t.getTime();
    const maxT = pointsRaw[pointsRaw.length - 1].t.getTime();
    const ys = pointsRaw.map((p) => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanY = Math.max(0.1, maxY - minY);
    const marginY = Math.max(0.6, spanY * 0.12);
    const y0 = minY - marginY;
    const y1 = maxY + marginY;

    const plotW = Math.max(1, w - padding.l - padding.r);
    const plotH = Math.max(1, h - padding.t - padding.b);

    const xForT = (t) => {
      if (maxT === minT) return padding.l + plotW / 2;
      return padding.l + ((t - minT) / (maxT - minT)) * plotW;
    };
    const yForV = (v) => padding.t + (1 - (v - y0) / (y1 - y0)) * plotH;

    // axes
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.l, padding.t);
    ctx.lineTo(padding.l, padding.t + plotH);
    ctx.lineTo(padding.l + plotW, padding.t + plotH);
    ctx.stroke();

    // y ticks
    ctx.fillStyle = 'rgba(234,242,255,.85)';
    ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    for (let i = 0; i < 3; i++) {
      const vv = y0 + (i / 2) * (y1 - y0);
      const yy = yForV(vv);
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath();
      ctx.moveTo(padding.l, yy);
      ctx.lineTo(padding.l + plotW, yy);
      ctx.stroke();
      ctx.fillText(vv.toFixed(1).replace('.', ','), 6, yy + 4);
    }

    // line
    const pts = pointsRaw.map((p) => ({
      x: xForT(p.t.getTime()),
      y: yForV(p.y),
      t: p.t,
      v: p.y
    }));

    ctx.strokeStyle = 'rgba(73,197,182,.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    ctx.fillStyle = 'rgba(122,167,255,.95)';
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    chartState.points = pts;
    chartState.rangeDays = rangeDays;
  }

  function findClosestChartPoint(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let bestD = Infinity;
    for (const p of chartState.points) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return bestD <= 18 ? best : null;
  }

  function showChartTooltip(point) {
    if (!weightChartTooltip) return;
    if (!point) {
      weightChartTooltip.hidden = true;
      return;
    }
    weightChartTooltip.textContent = `${formatDateShortPtBr(point.t)} ${formatTimeShortPtBr(point.t)} • ${formatKg(point.v)}`;
    weightChartTooltip.hidden = false;
  }

  async function renderWeightChart(rangeDays, cache = null) {
    if (!weightChartCanvas) return;
    const weights = cache?.weights || await getAll(STORE_WEIGHTS);
    const weightsDesc = [...weights].sort(sortByDateTimeDesc);
    chartState.weightsDesc = weightsDesc;
    setChartRangeButtons(rangeDays);
    drawWeightChart(weightChartCanvas, weightsDesc, rangeDays);
    showChartTooltip(null);
  }

  // -----------------------------
  // Resumo semanal (WhatsApp) - V3
  // -----------------------------

  function mean(nums) {
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function formatMaybeKg(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return `${n.toFixed(1).replace('.', ',')} kg`;
  }

  function buildWeeklySummaryText(cache, settings, weekOffset = 0) {
    const offset = Math.max(0, Math.floor(Number(weekOffset) || 0));
    const base = startOfWeekMonday(now());
    const start = addDays(base, -7 * offset);
    const end = endOfWeekSunday(start);

    const weightsAsc = [...cache.weights]
      .filter((w) => {
        const dt = new Date(w.dateTimeISO);
        return dt >= start && dt <= end;
      })
      .sort((a, b) => new Date(a.dateTimeISO) - new Date(b.dateTimeISO));

    const injectionsAsc = [...cache.injections]
      .filter((i) => {
        const dt = new Date(i.dateTimeISO);
        return dt >= start && dt <= end;
      })
      .sort((a, b) => new Date(a.dateTimeISO) - new Date(b.dateTimeISO));

    const weekLabel = formatWeekRangeLabel(start);

    const weightStart = weightsAsc[0]?.weightKg ?? null;
    const weightEnd = weightsAsc[weightsAsc.length - 1]?.weightKg ?? null;
    const weightDelta = (Number.isFinite(weightStart) && Number.isFinite(weightEnd)) ? (weightEnd - weightStart) : null;
    const bestW = weightsAsc.length ? Math.min(...weightsAsc.map((w) => w.weightKg)) : null;
    const worstW = weightsAsc.length ? Math.max(...weightsAsc.map((w) => w.weightKg)) : null;

    const injDow = clampNumber(settings.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6);
    const injPreferred = injectionsAsc.find((i) => new Date(i.dateTimeISO).getDay() === injDow) || injectionsAsc[0] || null;

    const sym = injectionsAsc.length
      ? computeCommonSymptoms([...injectionsAsc].sort(sortByDateTimeDesc))
      : { top: [], averages: {} };
    const symAvg = Object.keys(sym.averages || {}).map((k) => `${SYMPTOMS_LABELS[k]} ${(sym.averages[k] ?? 0).toFixed(1).replace('.', ',')}`);
    const top2 = (sym.top || []).map((x) => `${x.label} ${x.avg.toFixed(1).replace('.', ',')}`);

    const focus = (() => {
      const weighDows = new Set(settings.weighDaysOfWeek || DEFAULTS.weighDaysOfWeek);
      const expected = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, i);
        if (weighDows.has(d.getDay())) expected.push(getLocalDateKey(d));
      }
      const done = expected.filter((k) => cache.weightKeys.has(k)).length;
      if (expected.length - done >= 2) return 'rotina de pesagem';
      if (sym.top?.[0] && sym.top[0].avg >= 6.5) return 'refeições leves e hidratação';
      return 'água, proteína e sono';
    })();

    const lines = [];
    lines.push(`Semana ${weekLabel}`);
    lines.push('');
    if (weightStart !== null && weightEnd !== null) {
      const sign = weightDelta > 0 ? '+' : '';
      lines.push(`Peso: ${formatMaybeKg(weightStart)} → ${formatMaybeKg(weightEnd)} (${sign}${formatMaybeKg(weightDelta).replace(' kg', '')} kg)`);
      if (bestW !== null && worstW !== null) {
        lines.push(`Melhor pesagem: ${formatMaybeKg(bestW)} • Pior pesagem: ${formatMaybeKg(worstW)}`);
      }
    } else {
      lines.push('Peso: sem dados suficientes na semana');
    }

    if (injPreferred) {
      const dt = new Date(injPreferred.dateTimeISO);
      lines.push(`Aplicação: feita • ${formatDateShortPtBr(dt)} ${formatTimeShortPtBr(dt)} • ${siteLabel(injPreferred.site)} • ${formatDoseMg(injPreferred.doseMg)}`);
    } else {
      lines.push('Aplicação: não registrada na semana');
    }

    if (symAvg.length) {
      lines.push(`Sintomas médios (0–10): ${symAvg.join(' • ')}`);
      if (top2.length) lines.push(`Top sintomas: ${top2.join(' • ')}`);
    } else {
      lines.push('Sintomas: sem registros na semana');
    }

    lines.push('');
    lines.push(`Nota rápida: foco da semana que vem: ${focus}.`);
    lines.push('Obs.: isso não é diagnóstico nem orientação médica.');
    return lines.join('\n');
  }

  async function generateWeeklySummary() {
    const cache = await buildChecklistCache();
    const settings = await getSettings();
    const weekOffset = weeklySummaryWeekEl?.value ? Number(weeklySummaryWeekEl.value) : 0;
    const text = buildWeeklySummaryText(cache, settings, weekOffset);
    if (weeklySummaryTextEl) weeklySummaryTextEl.value = text;
    return text;
  }

  // -----------------------------
  // Inovação (insights locais) - V3
  // -----------------------------

  function buildLocalInsights(cache, settings) {
    const items = [];

    const cutoff14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const w14 = cache.weights
      .filter((w) => new Date(w.dateTimeISO) >= cutoff14)
      .sort((a, b) => new Date(a.dateTimeISO) - new Date(b.dateTimeISO));
    if (w14.length >= 6) {
      const ys = w14.map((w) => w.weightKg).filter((x) => Number.isFinite(x));
      if (ys.length >= 6) {
        const span = Math.max(...ys) - Math.min(...ys);
        if (span < 0.3) {
          items.push({
            title: 'Possível platô',
            insight: 'Nos últimos 14 dias, o peso oscilou pouco (< 0,3 kg) com várias pesagens.',
            action: 'Cheque consistência de água, proteína e sono. Pequenos ajustes de rotina ajudam.',
            kind: 'warn'
          });
        }
      }
    }

    const wAsc = [...cache.weights].sort((a, b) => new Date(a.dateTimeISO) - new Date(b.dateTimeISO));
    for (let i = 0; i < wAsc.length - 2; i++) {
      const a = wAsc[i];
      const b = wAsc[i + 1];
      const c = wAsc[i + 2];
      const ta = new Date(a.dateTimeISO).getTime();
      const tb = new Date(b.dateTimeISO).getTime();
      const tc = new Date(c.dateTimeISO).getTime();
      if ((tb - ta) > 48 * 60 * 60 * 1000) continue;
      const up = b.weightKg - a.weightKg;
      if (up <= 1.0) continue;
      if ((tc - tb) > 72 * 60 * 60 * 1000) continue;
      const back = Math.abs(c.weightKg - a.weightKg);
      if (back <= 0.3) {
        items.push({
          title: 'Oscilação compatível com retenção',
          insight: 'Teve uma subida rápida de peso e retorno em poucos dias, padrão comum em variação de água.',
          action: 'Compare pesagens em condições similares e observe sono/sódio/treino. Isso não é diagnóstico.',
          kind: 'info'
        });
        break;
      }
    }

    const start = startOfWeekMonday(now());
    const weighDows = new Set(settings.weighDaysOfWeek || DEFAULTS.weighDaysOfWeek);
    const expected = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (weighDows.has(d.getDay())) expected.push(getLocalDateKey(d));
    }
    const done = expected.filter((k) => cache.weightKeys.has(k)).length;
    if (expected.length - done >= 2) {
      items.push({
        title: 'Rotina de pesagem',
        insight: 'Nesta semana, faltaram 2+ pesagens esperadas. Isso reduz a qualidade dos insights.',
        action: 'Sugestão: pese ao acordar e registre rapidinho (mesma condição).',
        kind: 'warn'
      });
    }

    const injDow = clampNumber(settings.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6);
    const lastInj = [...cache.injections].sort(sortByDateTimeDesc)[0] || null;
    if (lastInj) {
      const d = new Date(lastInj.dateTimeISO);
      if (d.getDay() !== injDow) {
        items.push({
          title: 'Irregularidade de agenda',
          insight: `A última aplicação registrada foi em ${formatDowPtBr(d.getDay())}, mas a agenda fixa é ${formatDowPtBr(injDow)}.`,
          action: 'Se foi exceção, ok. Registre as datas para o relatório ficar consistente.',
          kind: 'warn'
        });
      }
    }

    const injDesc = [...cache.injections].sort(sortByDateTimeDesc);
    if (injDesc.length >= 2) {
      const a = clampNumber(injDesc[0]?.symptoms?.nausea ?? 0, 0, 10);
      const b = clampNumber(injDesc[1]?.symptoms?.nausea ?? 0, 0, 10);
      if (a >= 7 && b >= 7) {
        items.push({
          title: 'Náusea alta recorrente',
          insight: 'Náusea ≥ 7/10 em aplicações recentes pode sugerir tolerância baixa naquele período.',
          action: 'Considere conversar com um médico. Isso não é diagnóstico.',
          kind: 'danger'
        });
      }
    }

    if (!items.length) {
      items.push({
        title: 'Sem alertas por regras locais',
        insight: 'Nada relevante detectado pelas regras simples no momento.',
        action: 'Mantenha os registros para ganhar mais sinal.',
        kind: 'ok'
      });
    }

    return items;
  }

  function renderLocalInsights(items) {
    if (!localInsightsList) return;
    clearChildren(localInsightsList);

    for (const it of items) {
      const item = createEl('div', { class: 'item', role: 'listitem' });
      const main = createEl('div', { class: 'item__main' });
      main.appendChild(createEl('div', { class: 'item__title' }, it.title));
      main.appendChild(createEl('div', { class: 'item__meta' }, it.insight));
      main.appendChild(createEl('div', { class: 'item__meta' }, `Ação: ${it.action}`));
      item.appendChild(main);

      const chipCls = it.kind === 'ok'
        ? 'chip chip--ok'
        : it.kind === 'danger'
          ? 'chip chip--danger'
          : it.kind === 'warn'
            ? 'chip chip--warn'
            : 'chip';
      const chipText = it.kind === 'ok'
        ? 'Ok'
        : it.kind === 'danger'
          ? 'Atenção'
          : it.kind === 'warn'
            ? 'Ajuste'
            : 'Info';
      item.appendChild(createEl('span', { class: chipCls }, chipText));
      localInsightsList.appendChild(item);
    }
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Retorna a chave de data local (sem timezone/UTC): YYYY-MM-DD
  // Requisito: evitar erro de timezone ao comparar registros por “dia”.
  function getLocalDateKey(date) {
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    return `${yyyy}-${mm}-${dd}`;
  }

  function parseDateKeyToLocalDate(dateKey, timeHHmm = '00:00') {
    const [y, m, d] = String(dateKey).split('-').map((x) => Number(x));
    const [hh, mi] = String(timeHHmm).split(':').map((x) => Number(x));
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mi || 0, 0, 0);
  }

  function compareDateKeys(a, b) {
    // YYYY-MM-DD lexicográfico funciona.
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function toLocalDateTimeInputValue(date) {
    // datetime-local precisa de YYYY-MM-DDTHH:mm
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const mi = pad2(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function parseLocalDateTimeInputToISO(value) {
    // value: YYYY-MM-DDTHH:mm
    // Interpretar como horário local, convertendo para ISO (UTC) de forma estável.
    if (!value) return null;
    const [datePart, timePart] = value.split('T');
    if (!datePart || !timePart) return null;
    const [y, m, d] = datePart.split('-').map((x) => Number(x));
    const [hh, mi] = timePart.split(':').map((x) => Number(x));
    const dt = new Date(y, m - 1, d, hh, mi, 0, 0);
    return dt.toISOString();
  }

  function parseDateInputToISO(value) {
    // date: YYYY-MM-DD -> ISO com meia-noite local
    if (!value) return null;
    const [y, m, d] = value.split('-').map((x) => Number(x));
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    return dt.toISOString().slice(0, 10); // dateISO
  }

  function formatDateTimePtBr(isoString) {
    const d = new Date(isoString);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatDatePtBr(dateISO) {
    // dateISO: YYYY-MM-DD
    const [y, m, d] = dateISO.split('-').map((x) => Number(x));
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('pt-BR', { dateStyle: 'short' });
  }

  function formatKg(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    return `${n.toFixed(1).replace('.', ',')} kg`;
  }

  function formatCm(n) {
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
    return `${Number(n).toFixed(1).replace('.', ',')} cm`;
  }

  function formatDoseMg(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    return `${n.toFixed(1).replace('.', ',')} mg`;
  }

  function uuid() {
    // UUID simples, suficiente para uso local
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function daysBetween(a, b) {
    // diferença absoluta em dias
    const ms = Math.abs(a.getTime() - b.getTime());
    return ms / (1000 * 60 * 60 * 24);
  }

  function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }

  function now() {
    return new Date();
  }

  function isInLastDays(isoString, days) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return new Date(isoString) >= cutoff;
  }

  // -----------------------------
  // Toast (confirmação após salvar)
  // -----------------------------

  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2200);
  }

  // -----------------------------
  // IndexedDB (wrapper minimalista)
  // -----------------------------

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains(STORE_INJECTIONS)) {
          const s = db.createObjectStore(STORE_INJECTIONS, { keyPath: 'id' });
          s.createIndex('dateTimeISO', 'dateTimeISO', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_WEIGHTS)) {
          const s = db.createObjectStore(STORE_WEIGHTS, { keyPath: 'id' });
          s.createIndex('dateTimeISO', 'dateTimeISO', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_MEASURES)) {
          const s = db.createObjectStore(STORE_MEASURES, { keyPath: 'id' });
          s.createIndex('dateISO', 'dateISO', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const resultPromise = (async () => fn(store))();

      tx.oncomplete = async () => {
        db.close();
        try {
          resolve(await resultPromise);
        } catch (e) {
          reject(e);
        }
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  async function getAll(storeName) {
    return withStore(storeName, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function put(storeName, value) {
    return withStore(storeName, 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.put(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function del(storeName, id) {
    return withStore(storeName, 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function getByKey(storeName, key) {
    return withStore(storeName, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function clearStore(storeName) {
    return withStore(storeName, 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    });
  }

  // -----------------------------
  // Modelos (conforme especificação)
  // -----------------------------

  function normalizeInjection(input) {
    return {
      id: input.id || uuid(),
      dateTimeISO: input.dateTimeISO,
      medName: String(input.medName || 'Retatrutida').trim() || 'Retatrutida',
      doseMg: Number(input.doseMg),
      site: String(input.site || 'abdomen_right'),
      symptoms: {
        nausea: clampNumber(input.symptoms?.nausea ?? 0, 0, 10),
        reflux: clampNumber(input.symptoms?.reflux ?? 0, 0, 10),
        appetite: clampNumber(input.symptoms?.appetite ?? 0, 0, 10),
        energy: clampNumber(input.symptoms?.energy ?? 0, 0, 10),
        bowel: clampNumber(input.symptoms?.bowel ?? 0, 0, 10)
      },
      notes: String(input.notes || '').trim()
    };
  }

  function normalizeWeight(input) {
    return {
      id: input.id || uuid(),
      dateTimeISO: input.dateTimeISO,
      weightKg: Number(input.weightKg),
      fasting: Boolean(input.fasting),
      notes: String(input.notes || '').trim()
    };
  }

  function normalizeMeasures(input) {
    // Alguns campos podem ficar vazios; manter null é melhor do que NaN.
    const nOrNull = (v) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    return {
      id: input.id || uuid(),
      dateISO: input.dateISO,
      waistCm: nOrNull(input.waistCm),
      hipCm: nOrNull(input.hipCm),
      armLCm: nOrNull(input.armLCm),
      armRCm: nOrNull(input.armRCm),
      thighCm: nOrNull(input.thighCm),
      calfCm: nOrNull(input.calfCm),
      chestCm: nOrNull(input.chestCm),
      neckCm: nOrNull(input.neckCm),
      notes: String(input.notes || '').trim()
    };
  }

  // -----------------------------
  // Configurações (lembrete)
  // -----------------------------

  async function getSettings() {
    const s = await getByKey(STORE_SETTINGS, SETTINGS_KEY);
    const val = s?.value || {};
    return {
      ...DEFAULTS,
      ...val
    };
  }

  async function saveSettings(settings) {
    // Merge com valores atuais para não apagar campos quando salvar seções diferentes do menu.
    const current = await getSettings();
    const merged = {
      ...current,
      ...(settings || {})
    };

    const cleanedWeigh = Array.isArray(merged.weighDaysOfWeek)
      ? merged.weighDaysOfWeek.map((d) => clampNumber(d, 0, 6))
      : [...DEFAULTS.weighDaysOfWeek];
    const uniqueWeigh = Array.from(new Set(cleanedWeigh)).sort((a, b) => a - b);

    const cleaned = {
      reminderDow: merged.reminderDow === '' ? '' : String(merged.reminderDow),
      reminderTime: String(merged.reminderTime || DEFAULTS.reminderTime),

      injectionDayOfWeek: clampNumber(merged.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6),
      injectionTime: String(merged.injectionTime || DEFAULTS.injectionTime),
      weighDaysOfWeek: uniqueWeigh.length ? uniqueWeigh : [...DEFAULTS.weighDaysOfWeek],
      measureReminderEveryDays: Math.max(7, Math.floor(Number(merged.measureReminderEveryDays || DEFAULTS.measureReminderEveryDays))),

      patientName: String(merged.patientName || '').trim(),
      patientBirthYear: String(merged.patientBirthYear || '').trim(),
      preferredReportRangeDays: [30, 90, 180].includes(Number(merged.preferredReportRangeDays))
        ? Number(merged.preferredReportRangeDays)
        : DEFAULTS.preferredReportRangeDays,

      enableArmSites: Boolean(merged.enableArmSites)
    };
    await put(STORE_SETTINGS, { key: SETTINGS_KEY, value: cleaned });
    return cleaned;
  }

  function computeNextReminderDate(settings, fromDate = now()) {
    if (settings.reminderDow === '' || settings.reminderDow === null || settings.reminderDow === undefined) {
      return null;
    }

    const dow = Number(settings.reminderDow);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null;

    const [hh, mm] = String(settings.reminderTime || '19:00').split(':').map((x) => Number(x));
    const base = new Date(fromDate.getTime());

    // Calcular o próximo dia da semana desejado.
    const currentDow = base.getDay();
    let delta = (dow - currentDow + 7) % 7;

    const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh || 0, mm || 0, 0, 0);
    if (delta === 0 && candidate <= base) {
      delta = 7;
    }
    candidate.setDate(candidate.getDate() + delta);
    return candidate;
  }

  function describeDueBanner(nextDue) {
    const n = now();
    const diffMs = nextDue.getTime() - n.getTime();

    const whenText = nextDue.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    if (diffMs < 0) {
      // Atrasado (mostrar até o próximo ciclo)
      return {
        kind: 'overdue',
        text: `Atenção: lembrete de aplicação estava para ${whenText}. Se já aplicou, registre para manter o histórico.`
      };
    }

    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours <= 24) {
      return {
        kind: 'soon',
        text: `Lembrete: aplicação programada para ${whenText}.`
      };
    }

    return {
      kind: 'future',
      text: `Próximo lembrete: ${whenText}.`
    };
  }

  // -----------------------------
  // Rodízio de local (V2)
  // -----------------------------

  function getRotationSites(settings) {
    const enableArm = Boolean(settings?.enableArmSites);
    return enableArm ? [...ROTATION_SITES_DEFAULT] : ROTATION_SITES_DEFAULT.slice(0, 4);
  }

  // Requisito: getNextInjectionSite() baseada na última aplicação registrada.
  async function getNextInjectionSite(injectionsDesc = null, settings = null) {
    const s = settings || await getSettings();
    const rotation = getRotationSites(s);
    const injections = injectionsDesc || await getAll(STORE_INJECTIONS);
    const sorted = [...injections].sort(sortByDateTimeDesc);

    const lastSite = sorted[0]?.site;
    if (!lastSite) return rotation[0];
    const idx = rotation.indexOf(lastSite);
    if (idx === -1) return rotation[0];
    return rotation[(idx + 1) % rotation.length];
  }

  function applyArmSitesVisibility(enableArm) {
    const select = document.getElementById('injSite');
    if (!select) return;
    const armValues = new Set(['arm_right', 'arm_left']);
    for (const opt of Array.from(select.options || [])) {
      if (!armValues.has(opt.value)) continue;
      opt.hidden = !enableArm;
      opt.disabled = !enableArm;
    }
  }

  // -----------------------------
  // Cálculos para dashboard
  // -----------------------------

  function sortByDateTimeDesc(a, b) {
    return new Date(b.dateTimeISO).getTime() - new Date(a.dateTimeISO).getTime();
  }

  function sortByDateDesc(a, b) {
    // dateISO: YYYY-MM-DD
    return b.dateISO.localeCompare(a.dateISO);
  }

  function pickWeightClosestAtOrBefore(weightsDesc, targetDate) {
    // weightsDesc já em ordem desc
    const target = targetDate.getTime();
    for (const w of weightsDesc) {
      const t = new Date(w.dateTimeISO).getTime();
      if (t <= target) return w;
    }
    return null;
  }

  function formatDeltaKg(delta) {
    if (delta === null) return '—';
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(1).replace('.', ',')} kg`;
  }

  function computeWeightDeltas(weightsDesc) {
    if (weightsDesc.length === 0) {
      return { last: null, d7: null, d14: null, d30: null, lastDate: null };
    }

    const last = weightsDesc[0];
    const lastDate = new Date(last.dateTimeISO);

    const t7 = addDays(lastDate, -7);
    const t14 = addDays(lastDate, -14);
    const t30 = addDays(lastDate, -30);

    const w7 = pickWeightClosestAtOrBefore(weightsDesc, t7);
    const w14 = pickWeightClosestAtOrBefore(weightsDesc, t14);
    const w30 = pickWeightClosestAtOrBefore(weightsDesc, t30);

    const d = (w) => (w ? last.weightKg - w.weightKg : null);

    return {
      last,
      lastDate,
      d7: d(w7),
      d14: d(w14),
      d30: d(w30)
    };
  }

  // -----------------------------
  // SPA: roteamento e render
  // -----------------------------

  const views = {
    dashboard: document.getElementById('viewDashboard'),
    injections: document.getElementById('viewInjections'),
    body: document.getElementById('viewBody'),
    insights: document.getElementById('viewInsights'),
    report: document.getElementById('viewReport'),
    settings: document.getElementById('viewSettings')
  };

  const tabs = {
    dashboard: document.getElementById('tabDashboard'),
    injections: document.getElementById('tabInjections'),
    body: document.getElementById('tabBody'),
    insights: document.getElementById('tabInsights'),
    report: document.getElementById('tabReport'),
    settings: document.getElementById('tabSettings')
  };

  function getRoute() {
    const h = location.hash || '#/dashboard';
    const match = h.match(/^#\/(dashboard|injections|body|insights|report|settings)/);
    return match ? match[1] : 'dashboard';
  }

  function showView(route) {
    Object.entries(views).forEach(([k, el]) => {
      if (!el) return;
      el.hidden = k !== route;
    });
    Object.entries(tabs).forEach(([k, el]) => {
      if (!el) return;
      if (k === route) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  // -----------------------------
  // Elementos UI
  // -----------------------------

  const bannerReminder = document.getElementById('bannerReminder');
  const bannerUpdate = document.getElementById('bannerUpdate');
  const bannerUpdateText = document.getElementById('bannerUpdateText');
  const btnUpdateNow = document.getElementById('btnUpdateNow');
  const btnUpdateLater = document.getElementById('btnUpdateLater');

  const nextInjectionValue = document.getElementById('nextInjectionValue');
  const nextInjectionSub = document.getElementById('nextInjectionSub');

  const lastWeightValue = document.getElementById('lastWeightValue');
  const lastWeightSub = document.getElementById('lastWeightSub');
  const delta7 = document.getElementById('delta7');
  const delta14 = document.getElementById('delta14');
  const delta30 = document.getElementById('delta30');

  const timelineList = document.getElementById('timelineList');

  const injFilter = document.getElementById('injFilter');
  const injectionList = document.getElementById('injectionList');

  const weightList = document.getElementById('weightList');
  const measuresList = document.getElementById('measuresList');
  const measuresCompare = document.getElementById('measuresCompare');

  const insightsStatus = document.getElementById('insightsStatus');
  const insightsCards = document.getElementById('insightsCards');
  const insightsSummaryTextEl = document.getElementById('insightsSummaryText');
  const insightsRangeEl = document.getElementById('insightsRange');

  const menuDialog = document.getElementById('menuDialog');
  const btnOpenMenu = document.getElementById('btnOpenMenu');

  const reminderDowEl = document.getElementById('reminderDow');
  const reminderTimeEl = document.getElementById('reminderTime');

  const scheduleInjectionTimeEl = document.getElementById('scheduleInjectionTime');
  const scheduleMeasureEveryEl = document.getElementById('scheduleMeasureEvery');

  const weeklyConsistencyBadge = document.getElementById('weeklyConsistencyBadge');
  const weeklyConsistencyValue = document.getElementById('weeklyConsistencyValue');
  const weeklyConsistencyMeta = document.getElementById('weeklyConsistencyMeta');
  const weeklyConsistencyHint = document.getElementById('weeklyConsistencyHint');
  const streakWeightsEl = document.getElementById('streakWeights');
  const streakInjectionsEl = document.getElementById('streakInjections');
  const weeklyConsistencyWeekEl = document.getElementById('weeklyConsistencyWeek');

  const weightChartCanvas = document.getElementById('weightChart');
  const weightChartTooltip = document.getElementById('weightChartTooltip');
  const weightChartRange30Btn = document.getElementById('weightChartRange30');
  const weightChartRange90Btn = document.getElementById('weightChartRange90');

  const weeklySummaryTextEl = document.getElementById('weeklySummaryText');
  const weeklySummaryWeekEl = document.getElementById('weeklySummaryWeek');
  const localInsightsList = document.getElementById('localInsightsList');

  const reportRangeEl = document.getElementById('reportRange');
  const reportPatientNameEl = document.getElementById('reportPatientName');
  const reportPreviewEl = document.getElementById('reportPreview');

  const settingsPatientNameEl = document.getElementById('settingsPatientName');
  const settingsPatientBirthYearEl = document.getElementById('settingsPatientBirthYear');
  const settingsPreferredReportRangeEl = document.getElementById('settingsPreferredReportRange');
  const settingsInjectionDowEl = document.getElementById('settingsInjectionDow');
  const settingsInjectionTimeEl = document.getElementById('settingsInjectionTime');
  const settingsMeasureEveryEl = document.getElementById('settingsMeasureEvery');
  const settingsEnableArmSitesEl = document.getElementById('settingsEnableArmSites');
  const weighDow1El = document.getElementById('weighDow1');
  const weighDow3El = document.getElementById('weighDow3');
  const weighDow5El = document.getElementById('weighDow5');

  const injSiteHintEl = document.getElementById('injSiteHint');

  const checklistTodayBadge = document.getElementById('checklistTodayBadge');
  const checklistTodayMeta = document.getElementById('checklistTodayMeta');
  const checklistTodayAlerts = document.getElementById('checklistTodayAlerts');
  const checklistTodayList = document.getElementById('checklistTodayList');
  const checklistUpcomingList = document.getElementById('checklistUpcomingList');

  const injDialog = document.getElementById('injDialog');
  const injForm = document.getElementById('injForm');

  const injIdEl = document.getElementById('injId');
  const injDateTimeEl = document.getElementById('injDateTime');
  const injMedNameEl = document.getElementById('injMedName');
  const injDoseEl = document.getElementById('injDose');
  const injSiteEl = document.getElementById('injSite');
  const injNotesEl = document.getElementById('injNotes');

  const symEls = {
    nausea: document.getElementById('symNausea'),
    reflux: document.getElementById('symReflux'),
    appetite: document.getElementById('symAppetite'),
    energy: document.getElementById('symEnergy'),
    bowel: document.getElementById('symBowel')
  };
  const symValEls = {
    nausea: document.getElementById('symNauseaVal'),
    reflux: document.getElementById('symRefluxVal'),
    appetite: document.getElementById('symAppetiteVal'),
    energy: document.getElementById('symEnergyVal'),
    bowel: document.getElementById('symBowelVal')
  };

  const wDialog = document.getElementById('wDialog');
  const wForm = document.getElementById('wForm');
  const wIdEl = document.getElementById('wId');
  const wDateTimeEl = document.getElementById('wDateTime');
  const wKgEl = document.getElementById('wKg');
  const wFastingEl = document.getElementById('wFasting');
  const wNotesEl = document.getElementById('wNotes');

  const mDialog = document.getElementById('mDialog');
  const mForm = document.getElementById('mForm');
  const mIdEl = document.getElementById('mId');
  const mDateEl = document.getElementById('mDate');
  const mWaistEl = document.getElementById('mWaist');
  const mHipEl = document.getElementById('mHip');
  const mArmLEl = document.getElementById('mArmL');
  const mArmREl = document.getElementById('mArmR');
  const mThighEl = document.getElementById('mThigh');
  const mCalfEl = document.getElementById('mCalf');
  const mChestEl = document.getElementById('mChest');
  const mNeckEl = document.getElementById('mNeck');
  const mNotesEl = document.getElementById('mNotes');

  const restoreFileEl = document.getElementById('restoreFile');

  // -----------------------------
  // Render helpers
  // -----------------------------

  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function createEl(tag, attrs = {}, text = '') {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('aria-')) el.setAttribute(k, v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v);
    });
    if (text) el.textContent = text;
    return el;
  }

  function siteLabel(site) {
    return SITE_LABELS[site] || site;
  }

  function renderEmptyState(el, title, subtitle) {
    clearChildren(el);
    const item = createEl('div', { class: 'item', role: 'listitem' });
    const main = createEl('div', { class: 'item__main' });
    main.appendChild(createEl('div', { class: 'item__title' }, title));
    main.appendChild(createEl('div', { class: 'item__meta' }, subtitle));
    item.appendChild(main);
    el.appendChild(item);
  }

  function toDateKeyFromISO(isoString) {
    return getLocalDateKey(new Date(isoString));
  }

  function startOfWeekMonday(date) {
    const d = startOfDay(date);
    // Monday=0..Sunday=6
    const mondayIndex = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - mondayIndex);
    return d;
  }

  function endOfWeekSunday(startMonday) {
    const d = addDays(startMonday, 6);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }

  function formatDateShortPtBr(date) {
    return date.toLocaleDateString('pt-BR', { dateStyle: 'short' });
  }

  function formatTimeShortPtBr(date) {
    return date.toLocaleTimeString('pt-BR', { timeStyle: 'short' });
  }

  function formatWeekRangeLabel(startMonday) {
    const end = endOfWeekSunday(startMonday);
    return `${formatDateShortPtBr(startMonday)}–${formatDateShortPtBr(end)}`;
  }

  function computeNextScheduledDateTime(settings, fromDate = now()) {
    const dow = clampNumber(settings?.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6);
    const [hh, mm] = String(settings?.injectionTime || DEFAULTS.injectionTime).split(':').map((x) => Number(x));
    const base = new Date(fromDate.getTime());

    const currentDow = base.getDay();
    let delta = (dow - currentDow + 7) % 7;
    const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh || 0, mm || 0, 0, 0);
    if (delta === 0 && candidate <= base) delta = 7;
    candidate.setDate(candidate.getDate() + delta);
    return candidate;
  }

  function statusBadgeFromPercent(pct) {
    if (pct >= 90) return { label: 'Excelente', cls: 'chip chip--ok' };
    if (pct >= 70) return { label: 'Boa', cls: 'chip chip--warn' };
    return { label: 'Ajustar', cls: 'chip chip--danger' };
  }

  async function copyTextToClipboard(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copiado.');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('Copiado.');
    }
  }

  function whatsappShareUrl(text) {
    const msg = String(text || '');
    return `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }

  async function shareText(titleOrObj, textMaybe) {
    let title = titleOrObj;
    let text = textMaybe;
    if (titleOrObj && typeof titleOrObj === 'object') {
      title = titleOrObj.title;
      text = titleOrObj.text;
    }
    if (!text) return;
    if (typeof navigator.share !== 'function') {
      await copyTextToClipboard(text);
      return;
    }
    try {
      await navigator.share({ title: String(title || ''), text: String(text || '') });
    } catch {
      // cancelado
    }
  }

  // -----------------------------
  // Checklist & Alertas (agenda fixa)
  // -----------------------------

  const CHECKLIST_CUTOFF_TIME = '12:00'; // regra: se não registrou até 12:00 -> aviso visual

  function isAfterTimeHHmm(date, timeHHmm) {
    const [hh, mi] = String(timeHHmm).split(':').map((x) => Number(x));
    if (!Number.isFinite(hh) || !Number.isFinite(mi)) return false;
    const cutoff = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mi, 0, 0);
    return date >= cutoff;
  }

  async function buildChecklistCache() {
    const [weights, injections, measures] = await Promise.all([
      getAll(STORE_WEIGHTS),
      getAll(STORE_INJECTIONS),
      getAll(STORE_MEASURES)
    ]);

    const weightKeys = new Set(weights.map((w) => getLocalDateKey(new Date(w.dateTimeISO))));
    const injectionKeys = new Set(injections.map((i) => getLocalDateKey(new Date(i.dateTimeISO))));
    const measuresKeys = new Set(measures.map((m) => m.dateISO));

    const measuresSorted = [...measures].sort(sortByDateDesc);
    const lastMeasures = measuresSorted[0] || null;

    return { weights, injections, measures, weightKeys, injectionKeys, measuresKeys, lastMeasures };
  }

  // Requisito: isWeightLoggedOn(dateKey)
  async function isWeightLoggedOn(dateKey, cache = null) {
    if (cache?.weightKeys) return cache.weightKeys.has(dateKey);
    const weights = await getAll(STORE_WEIGHTS);
    return weights.some((w) => getLocalDateKey(new Date(w.dateTimeISO)) === dateKey);
  }

  // Requisito: isInjectionLoggedOn(dateKey)
  async function isInjectionLoggedOn(dateKey, cache = null) {
    if (cache?.injectionKeys) return cache.injectionKeys.has(dateKey);
    const injections = await getAll(STORE_INJECTIONS);
    return injections.some((i) => getLocalDateKey(new Date(i.dateTimeISO)) === dateKey);
  }

  // Requisito: isMeasuresLoggedOn(dateKey)
  async function isMeasuresLoggedOn(dateKey, cache = null) {
    if (cache?.measuresKeys) return cache.measuresKeys.has(dateKey);
    const measures = await getAll(STORE_MEASURES);
    return measures.some((m) => m.dateISO === dateKey);
  }

  function formatDowPtBr(dow) {
    const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return names[dow] || '—';
  }

  function formatDateKeyShortPtBr(dateKey) {
    // YYYY-MM-DD -> dd/mm
    const [y, m, d] = String(dateKey).split('-');
    return `${d}/${m}`;
  }

  function getStatus(item, nowDate) {
    // Requisito: pending/done/late
    if (item.done) return 'done';
    const todayKey = getLocalDateKey(nowDate);
    if (compareDateKeys(item.dateKey, todayKey) < 0) return 'late';
    return 'pending';
  }

  function statusLabel(status) {
    if (status === 'done') return 'Concluído';
    if (status === 'late') return 'Atrasado';
    return 'Pendente';
  }

  function statusChipClass(status, required) {
    if (status === 'done') return 'chip chip--ok';
    if (status === 'late') return required ? 'chip chip--danger' : 'chip chip--warn';
    return required ? 'chip chip--warn' : 'chip';
  }

  function computeMeasuresDueDateKey(cache, settings, todayKey) {
    const every = Math.max(7, Math.floor(Number(settings.measureReminderEveryDays || DEFAULTS.measureReminderEveryDays)));
    // Se nunca registrou medidas, mostrar um lembrete leve hoje (opcional).
    if (!cache?.lastMeasures?.dateISO) return todayKey;

    const base = parseDateKeyToLocalDate(cache.lastMeasures.dateISO, '00:00');
    const due = addDays(base, every);
    const dueKey = getLocalDateKey(due);

    // Se estiver atrasado, continuamos lembrando “a partir de hoje” até registrar novamente.
    if (compareDateKeys(dueKey, todayKey) < 0) return todayKey;
    return dueKey;
  }

  // Requisito: buildChecklistForDate(date)
  async function buildChecklistForDate(date, cache = null, settings = null, nowDate = now()) {
    const s = settings || (await getSettings());
    const c = cache || (await buildChecklistCache());

    const dateKey = getLocalDateKey(date);
    const todayKey = getLocalDateKey(nowDate);
    const dow = date.getDay();

    const items = [];

    // Peso (obrigatório em dias configurados)
    if (Array.isArray(s.weighDaysOfWeek) && s.weighDaysOfWeek.includes(dow)) {
      const done = await isWeightLoggedOn(dateKey, c);
      items.push({
        kind: 'weight',
        title: 'Pesagem',
        dateKey,
        required: true,
        done,
        warnAfterCutoff: compareDateKeys(dateKey, todayKey) === 0 && isAfterTimeHHmm(nowDate, CHECKLIST_CUTOFF_TIME) && !done
      });
    }

    // Aplicação (sábado fixo)
    if (dow === Number(s.injectionDayOfWeek)) {
      const done = await isInjectionLoggedOn(dateKey, c);
      items.push({
        kind: 'injection',
        title: 'Aplicação',
        dateKey,
        required: true,
        done,
        warnAfterCutoff: compareDateKeys(dateKey, todayKey) === 0 && isAfterTimeHHmm(nowDate, CHECKLIST_CUTOFF_TIME) && !done,
        meta: `Horário alvo: ${String(s.injectionTime || DEFAULTS.injectionTime)}`
      });
    }

    // Medidas (lembrete leve a cada N dias)
    const measuresDueKey = computeMeasuresDueDateKey(c, s, todayKey);
    if (measuresDueKey && compareDateKeys(dateKey, measuresDueKey) === 0) {
      const done = await isMeasuresLoggedOn(dateKey, c);
      items.push({
        kind: 'measures',
        title: 'Medidas (opcional)',
        dateKey,
        required: false,
        done,
        meta: `Sugestão: a cada ${Math.max(7, Math.floor(Number(s.measureReminderEveryDays || DEFAULTS.measureReminderEveryDays)))} dias`
      });
    }

    // Status
    for (const it of items) {
      it.status = getStatus(it, nowDate);
    }

    return items;
  }

  // Requisito: buildUpcomingChecklist(days=7)
  async function buildUpcomingChecklist(days = 7) {
    const s = await getSettings();
    const c = await buildChecklistCache();
    const base = startOfDay(now());

    const list = [];
    for (let i = 1; i <= days; i++) {
      const d = addDays(base, i);
      const dateKey = getLocalDateKey(d);
      const items = await buildChecklistForDate(d, c, s, now());

      if (items.length) {
        list.push({
          dateKey,
          dow: d.getDay(),
          items
        });
      }
    }

    return list;
  }

  async function buildOverdueChecklist(daysBack = 7) {
    const s = await getSettings();
    const c = await buildChecklistCache();
    const base = startOfDay(now());

    const overdue = [];
    for (let i = 1; i <= daysBack; i++) {
      const d = addDays(base, -i);
      const items = await buildChecklistForDate(d, c, s, now());
      for (const it of items) {
        if (!it.required) continue;
        if (it.done) continue;
        it.status = 'late';
        it.warnAfterCutoff = false;
        overdue.push(it);
      }
    }

    // Mais recentes primeiro
    overdue.sort((a, b) => compareDateKeys(b.dateKey, a.dateKey));
    return overdue;
  }

  function renderChecklistItemRow(item) {
    const row = createEl('div', { class: 'item', role: 'listitem' });
    const left = createEl('div', { class: 'checkline__left' });

    const title = createEl('div', { class: 'checkline__title' }, item.title);
    const metaParts = [];
    if (item.meta) metaParts.push(item.meta);
    metaParts.push(`Data: ${formatDateKeyShortPtBr(item.dateKey)}`);
    if (item.status === 'late' && item.required) {
      metaParts.push('Sugestão: registre agora (se fizer sentido, use data retroativa).');
    }
    const meta = createEl('div', { class: 'checkline__meta' }, metaParts.join(' • '));

    left.appendChild(title);
    left.appendChild(meta);

    const chip = createEl('span', { class: statusChipClass(item.status, item.required) }, statusLabel(item.status));

    row.appendChild(left);
    row.appendChild(chip);
    return row;
  }

  async function renderDashboardChecklist(cache = null, settings = null, nowDate = now()) {
    if (!checklistTodayList || !checklistUpcomingList) return;

    const s = settings || (await getSettings());
    const c = cache || (await buildChecklistCache());
    const n = nowDate;
    const today = startOfDay(n);
    const todayKey = getLocalDateKey(today);

    if (checklistTodayMeta) {
      const weigh = Array.isArray(s.weighDaysOfWeek) && s.weighDaysOfWeek.length
        ? s.weighDaysOfWeek.map((d) => formatDowPtBr(d)).join('/')
        : '—';
      const injDow = clampNumber(s.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6);
      checklistTodayMeta.textContent = `Hoje (${formatDowPtBr(today.getDay())} • ${formatDateKeyShortPtBr(todayKey)}). Agenda: pesagem ${weigh}; aplicação ${formatDowPtBr(injDow)} ${s.injectionTime}; medidas a cada ${s.measureReminderEveryDays} dias.`;
    }

    // Hoje
    const todayItems = await buildChecklistForDate(today, c, s, n);
    const overdueItems = await buildOverdueChecklist(7);
    clearChildren(checklistTodayList);

    if (!todayItems.length && !overdueItems.length) {
      renderEmptyState(checklistTodayList, 'Nada obrigatório hoje', 'Aproveite para registrar se quiser (peso/medidas) e manter o histórico.');
    } else {
      if (overdueItems.length) {
        const header = createEl('div', { class: 'muted' }, 'Atrasos (últimos 7 dias)');
        checklistTodayList.appendChild(header);
        for (const it of overdueItems) {
          checklistTodayList.appendChild(renderChecklistItemRow(it));
        }
      }
      for (const it of todayItems) {
        checklistTodayList.appendChild(renderChecklistItemRow(it));
      }
    }

    // Badge resumida
    if (checklistTodayBadge) {
      const doneCount = todayItems.filter((x) => x.done).length;
      const total = todayItems.length;
      checklistTodayBadge.className = total === 0
        ? 'chip'
        : doneCount === total
          ? 'chip chip--ok'
          : 'chip chip--warn';
      checklistTodayBadge.textContent = total === 0
        ? (overdueItems.length ? `${overdueItems.length} atraso(s)` : 'Sem itens')
        : `${doneCount}/${total} feitos${overdueItems.length ? ` • ${overdueItems.length} atraso(s)` : ''}`;
    }

    // Alertas visuais após 12:00
    if (checklistTodayAlerts) {
      const warnings = [];
      const weightWarn = todayItems.find((x) => x.kind === 'weight' && x.warnAfterCutoff);
      const injWarn = todayItems.find((x) => x.kind === 'injection' && x.warnAfterCutoff);
      if (weightWarn) warnings.push('PESAGEM PENDENTE');
      if (injWarn) warnings.push('APLICAÇÃO PENDENTE');

      if (warnings.length) {
        checklistTodayAlerts.textContent = `${warnings.join(' • ')} — registre até o fim do dia para evitar ficar “atrasado”.`;
        checklistTodayAlerts.hidden = false;
      } else {
        checklistTodayAlerts.hidden = true;
      }
    }

    // Próximos 7 dias
    const upcoming = await buildUpcomingChecklist(7);
    clearChildren(checklistUpcomingList);
    if (!upcoming.length) {
      renderEmptyState(checklistUpcomingList, 'Nada agendado nos próximos 7 dias', 'Você pode ajustar a agenda no Menu.');
      return;
    }

    for (const day of upcoming) {
      const title = `${formatDowPtBr(day.dow)} • ${formatDateKeyShortPtBr(day.dateKey)}`;
      const doneCount = day.items.filter((x) => x.done).length;
      const total = day.items.length;
      const dayStatus = doneCount === total ? 'done' : 'pending';

      const item = createEl('div', { class: 'item', role: 'listitem' });
      const main = createEl('div', { class: 'item__main' });
      main.appendChild(createEl('div', { class: 'item__title' }, title));

      const summary = day.items.map((x) => `${x.title}${x.done ? ' ✓' : ''}`).join(' • ');
      main.appendChild(createEl('div', { class: 'item__meta' }, summary));

      const chip = createEl('span', { class: statusChipClass(dayStatus, true) }, doneCount === total ? 'Ok' : 'Pendente');

      item.appendChild(main);
      item.appendChild(chip);
      checklistUpcomingList.appendChild(item);
    }
  }

  // -----------------------------
  // Render: Dashboard
  // -----------------------------

  async function renderReminderBanner() {
    const settings = await getSettings();
    const next = computeNextReminderDate(settings);

    if (!bannerReminder) return;

    if (!next) {
      bannerReminder.hidden = true;
      return;
    }

    const info = describeDueBanner(next);
    bannerReminder.textContent = info.text;

    // Mostrar só quando está próximo (24h) ou atrasado.
    bannerReminder.hidden = !(info.kind === 'soon' || info.kind === 'overdue');
  }

  async function renderDashboard() {
    const n = now();
    const [injections, weights] = await Promise.all([getAll(STORE_INJECTIONS), getAll(STORE_WEIGHTS)]);

    injections.sort(sortByDateTimeDesc);
    weights.sort(sortByDateTimeDesc);

    // Próxima aplicação
    let nextText = '—';
    let nextSub = 'Configure seu lembrete ou registre uma aplicação.';

    const settings = await getSettings();
    const nextReminder = computeNextReminderDate(settings);

    if (injections.length > 0) {
      const last = injections[0];
      const lastDt = new Date(last.dateTimeISO);
      const next = addDays(lastDt, 7);
      nextText = next.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      nextSub = `Baseado no último registro (${formatDateTimePtBr(last.dateTimeISO)}).`;

      if (nextReminder) {
        const r = nextReminder.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        nextSub += ` Lembrete configurado: ${r}.`;
      }
    } else if (nextReminder) {
      nextText = nextReminder.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      nextSub = 'Baseado no seu lembrete semanal.';
    }

    if (nextInjectionValue) nextInjectionValue.textContent = nextText;
    if (nextInjectionSub) nextInjectionSub.textContent = nextSub;

    // Peso + deltas
    const deltas = computeWeightDeltas(weights);
    if (deltas.last) {
      lastWeightValue.textContent = formatKg(deltas.last.weightKg);
      lastWeightSub.textContent = `Em ${formatDateTimePtBr(deltas.last.dateTimeISO)} (${deltas.last.fasting ? 'jejum' : 'sem jejum'}).`;
    } else {
      lastWeightValue.textContent = '—';
      lastWeightSub.textContent = 'Sem registros ainda.';
    }
    delta7.textContent = `7d: ${formatDeltaKg(deltas.d7)}`;
    delta14.textContent = `14d: ${formatDeltaKg(deltas.d14)}`;
    delta30.textContent = `30d: ${formatDeltaKg(deltas.d30)}`;

    // Checklist & Alertas (agenda fixa) + V3 (reusando cache para evitar leituras duplicadas)
    const cache = await buildChecklistCache();
    await renderDashboardChecklist(cache, settings, n);

    try {
      const weekOffset = weeklyConsistencyWeekEl?.value ? Number(weeklyConsistencyWeekEl.value) : 0;
      await renderWeeklyConsistency(cache, settings, weekOffset);
      await renderWeightChart(chartState.rangeDays, cache);
      renderLocalInsights(buildLocalInsights(cache, settings));
    } catch {
      // Não trava o dashboard
    }

    // Timeline consolidada (últimos 12 eventos)
    const timeline = [];
    for (const i of injections.slice(0, 50)) {
      timeline.push({
        type: 'inj',
        dateTimeISO: i.dateTimeISO,
        title: `${i.medName} • ${formatDoseMg(i.doseMg)}`,
        meta: `${formatDateTimePtBr(i.dateTimeISO)} • ${siteLabel(i.site)}`,
        id: i.id
      });
    }
    for (const w of weights.slice(0, 50)) {
      timeline.push({
        type: 'w',
        dateTimeISO: w.dateTimeISO,
        title: `Peso • ${formatKg(w.weightKg)}`,
        meta: `${formatDateTimePtBr(w.dateTimeISO)} • ${w.fasting ? 'jejum' : 'sem jejum'}`,
        id: w.id
      });
    }

    timeline.sort(sortByDateTimeDesc);

    clearChildren(timelineList);
    if (timeline.length === 0) {
      renderEmptyState(timelineList, 'Nada por aqui ainda', 'Registre uma aplicação ou um peso para começar.');
    } else {
      timeline.slice(0, 12).forEach((ev) => {
        const item = createEl('div', { class: 'item', role: 'listitem' });
        const main = createEl('div', { class: 'item__main' });
        main.appendChild(createEl('div', { class: 'item__title' }, ev.title));
        main.appendChild(createEl('div', { class: 'item__meta' }, ev.meta));
        item.appendChild(main);

        const actions = createEl('div', { class: 'item__actions' });
        const goBtn = createEl('button', {
          class: 'btn btn--secondary',
          type: 'button',
          dataset: { action: ev.type === 'inj' ? 'editInjection' : 'editWeight', id: ev.id }
        }, 'Editar');
        actions.appendChild(goBtn);

        item.appendChild(actions);
        timelineList.appendChild(item);
      });
    }

    await renderReminderBanner();
  }

  // -----------------------------
  // Render: Configurações (V3)
  // -----------------------------

  async function renderSettingsView() {
    const s = await getSettings();

    if (settingsPatientNameEl) settingsPatientNameEl.value = String(s.patientName || '');
    if (settingsPatientBirthYearEl) settingsPatientBirthYearEl.value = String(s.patientBirthYear || '');
    if (settingsPreferredReportRangeEl) settingsPreferredReportRangeEl.value = String(s.preferredReportRangeDays || DEFAULTS.preferredReportRangeDays);

    if (settingsInjectionDowEl) settingsInjectionDowEl.value = String(s.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek);
    if (settingsInjectionTimeEl) settingsInjectionTimeEl.value = String(s.injectionTime || DEFAULTS.injectionTime);

    if (weighDow1El) weighDow1El.checked = Array.isArray(s.weighDaysOfWeek) ? s.weighDaysOfWeek.includes(1) : true;
    if (weighDow3El) weighDow3El.checked = Array.isArray(s.weighDaysOfWeek) ? s.weighDaysOfWeek.includes(3) : true;
    if (weighDow5El) weighDow5El.checked = Array.isArray(s.weighDaysOfWeek) ? s.weighDaysOfWeek.includes(5) : true;

    if (settingsMeasureEveryEl) settingsMeasureEveryEl.value = String(s.measureReminderEveryDays || DEFAULTS.measureReminderEveryDays);
    if (settingsEnableArmSitesEl) settingsEnableArmSitesEl.value = String(Boolean(s.enableArmSites));
  }

  function readSettingsFromSettingsView() {
    const weigh = [];
    if (weighDow1El?.checked) weigh.push(1);
    if (weighDow3El?.checked) weigh.push(3);
    if (weighDow5El?.checked) weigh.push(5);

    return {
      patientName: settingsPatientNameEl?.value || '',
      patientBirthYear: settingsPatientBirthYearEl?.value || '',
      preferredReportRangeDays: settingsPreferredReportRangeEl?.value ? Number(settingsPreferredReportRangeEl.value) : undefined,
      injectionDayOfWeek: settingsInjectionDowEl?.value ? Number(settingsInjectionDowEl.value) : undefined,
      injectionTime: settingsInjectionTimeEl?.value || undefined,
      weighDaysOfWeek: weigh,
      measureReminderEveryDays: settingsMeasureEveryEl?.value ? Number(settingsMeasureEveryEl.value) : undefined,
      enableArmSites: settingsEnableArmSitesEl?.value === 'true'
    };
  }

  // -----------------------------
  // Relatório Médico (V3) - preview + print
  // -----------------------------

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildSummaryForDays(days, data) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const injections = data.injections.filter((i) => new Date(i.dateTimeISO) >= cutoff).sort(sortByDateTimeDesc);
    const weights = data.weights.filter((w) => new Date(w.dateTimeISO) >= cutoff).sort(sortByDateTimeDesc);
    const measures = data.measures.filter((m) => new Date(`${m.dateISO}T00:00:00`) >= cutoff).sort(sortByDateDesc);
    return {
      days,
      injections,
      weights,
      measures,
      injReg: computeInjectionRegularity(injections),
      wtTrend: computeWeightTrend(weights),
      msDelta: computeMeasuresDelta(measures),
      sym: computeCommonSymptoms(injections)
    };
  }

  function uniqueDateKeysFromDateTimeISO(items) {
    const keys = new Set();
    for (const it of items) {
      const d = new Date(it.dateTimeISO);
      keys.add(getLocalDateKey(d));
    }
    return keys;
  }

  function computeScheduleAdherenceForRange(rangeDays, settings, data) {
    const s = settings || DEFAULTS;
    const end = startOfDay(now());
    const start = addDays(end, -(Math.max(1, rangeDays) - 1));
    const weighDows = new Set(s.weighDaysOfWeek || DEFAULTS.weighDaysOfWeek);
    const injDow = clampNumber(s.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6);

    const weightKeys = uniqueDateKeysFromDateTimeISO(data.weights);
    const injKeys = uniqueDateKeysFromDateTimeISO(data.injections);

    let expectedWeights = 0;
    let doneWeights = 0;
    let expectedInj = 0;
    let doneInj = 0;

    for (let i = 0; i < rangeDays; i++) {
      const d = addDays(start, i);
      const key = getLocalDateKey(d);
      if (weighDows.has(d.getDay())) {
        expectedWeights += 1;
        if (weightKeys.has(key)) doneWeights += 1;
      }
      if (d.getDay() === injDow) {
        expectedInj += 1;
        if (injKeys.has(key)) doneInj += 1;
      }
    }

    // Mesmo critério do dashboard: pesagem=1 ponto, aplicação=2 pontos.
    const expectedPoints = expectedWeights + (expectedInj * 2);
    const donePoints = doneWeights + (doneInj * 2);
    const pct = expectedPoints ? Math.round((donePoints / expectedPoints) * 100) : 0;

    return { expectedWeights, doneWeights, expectedInj, doneInj, expectedPoints, donePoints, pct };
  }

  function computeDoseHistory(injectionsAsc) {
    const items = [];
    if (!injectionsAsc.length) return items;
    let lastDose = null;
    for (const inj of injectionsAsc) {
      const dose = Number(inj.doseMg);
      if (!Number.isFinite(dose)) continue;
      if (lastDose === null) {
        lastDose = dose;
        items.push({ dateTimeISO: inj.dateTimeISO, doseMg: dose });
        continue;
      }
      if (Math.abs(dose - lastDose) >= 0.0001) {
        lastDose = dose;
        items.push({ dateTimeISO: inj.dateTimeISO, doseMg: dose });
      }
    }
    // Se não houve mudança, mostramos só a última como “dose atual registrada”.
    if (items.length === 1) {
      const last = injectionsAsc[injectionsAsc.length - 1];
      const dose = Number(last.doseMg);
      if (Number.isFinite(dose)) return [{ dateTimeISO: last.dateTimeISO, doseMg: dose }];
    }
    return items;
  }

  function computeSymptomsAggregated(injections) {
    const keys = Object.keys(SYMPTOMS_LABELS);
    if (!injections.length) {
      return { means: {}, peaks: {} };
    }
    const sums = {};
    const peaks = {};
    for (const k of keys) {
      sums[k] = 0;
      peaks[k] = 0;
    }
    for (const inj of injections) {
      for (const k of keys) {
        const v = clampNumber(inj.symptoms?.[k] ?? 0, 0, 10);
        sums[k] += v;
        if (v > peaks[k]) peaks[k] = v;
      }
    }
    const means = {};
    for (const k of keys) {
      means[k] = sums[k] / injections.length;
    }
    return { means, peaks };
  }

  function formatSymptomCompact(sym) {
    if (!sym) return '—';
    const parts = [];
    for (const k of Object.keys(SYMPTOMS_LABELS)) {
      const v = clampNumber(sym[k] ?? 0, 0, 10);
      parts.push(`${SYMPTOMS_LABELS[k]} ${v}`);
    }
    return parts.join(' • ');
  }

  function collectPatientNotes(rangeDays, data, maxItems = 10) {
    const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    const notes = [];

    for (const w of data.weights) {
      if (!w?.notes) continue;
      if (new Date(w.dateTimeISO) < cutoff) continue;
      notes.push({
        dateTimeISO: w.dateTimeISO,
        kind: 'Peso',
        text: String(w.notes)
      });
    }
    for (const i of data.injections) {
      if (!i?.notes) continue;
      if (new Date(i.dateTimeISO) < cutoff) continue;
      notes.push({
        dateTimeISO: i.dateTimeISO,
        kind: 'Aplicação',
        text: String(i.notes)
      });
    }
    for (const m of data.measures) {
      if (!m?.notes) continue;
      const dt = new Date(`${m.dateISO}T00:00:00`);
      if (dt < cutoff) continue;
      notes.push({
        dateTimeISO: dt.toISOString(),
        kind: 'Medidas',
        text: String(m.notes)
      });
    }

    notes.sort(sortByDateTimeDesc);
    return notes.slice(0, maxItems);
  }

  function buildClinicalReportInnerHtml({ rangeDays, patientName, patientBirthYear, data, settings = null }) {
    const s = buildSummaryForDays(rangeDays, data);
    const generatedAt = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    const lastInj = s.injections[0] || null;
    const lastW = s.weights[0] || null;
    const lastM = s.measures[0] || null;

    const settingsResolved = settings || DEFAULTS;
    const injDow = clampNumber(settingsResolved.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek, 0, 6);
    const injTime = settingsResolved.injectionTime || DEFAULTS.injectionTime;

    const injRate = s.injReg.onTimeRate === null ? '—' : `${Math.round(s.injReg.onTimeRate * 100)}%`;
    const wtDelta = Number.isFinite(s.wtTrend.deltaKg) ? `${s.wtTrend.deltaKg >= 0 ? '+' : ''}${s.wtTrend.deltaKg.toFixed(1).replace('.', ',')} kg` : '—';
    const perWeek = Number.isFinite(s.wtTrend.perWeekKg) ? `${s.wtTrend.perWeekKg >= 0 ? '+' : ''}${s.wtTrend.perWeekKg.toFixed(2).replace('.', ',')} kg/sem` : '—';

    const deltaLines = [];
    for (const [k, v] of Object.entries(s.msDelta.deltas || {})) {
      deltaLines.push(`${k}: ${v >= 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} cm`);
    }

    const symAgg = computeSymptomsAggregated(s.injections);
    const notes = collectPatientNotes(rangeDays, data, 10);

    const weightsAsc = [...s.weights].sort((a, b) => new Date(a.dateTimeISO) - new Date(b.dateTimeISO));
    const injectionsAsc = [...s.injections].sort((a, b) => new Date(a.dateTimeISO) - new Date(b.dateTimeISO));
    const doseHistory = computeDoseHistory(injectionsAsc);
    const lastDose = injectionsAsc.length ? injectionsAsc[injectionsAsc.length - 1].doseMg : null;

    const adherence = computeScheduleAdherenceForRange(rangeDays, settingsResolved, { weights: s.weights, injections: s.injections });

    const wStart = s.wtTrend.start?.weightKg ?? null;
    const wEnd = s.wtTrend.end?.weightKg ?? null;
    const wStartText = wStart === null ? '—' : `${wStart.toFixed(1).replace('.', ',')} kg`;
    const wEndText = wEnd === null ? '—' : `${wEnd.toFixed(1).replace('.', ',')} kg`;

    const doseText = Number.isFinite(Number(lastDose)) ? formatDoseMg(lastDose) : '—';
    const doseHistoryText = doseHistory.length
      ? doseHistory.map((x) => `${formatDateTimePtBr(x.dateTimeISO)} → ${formatDoseMg(x.doseMg)}`).join('<br/>')
      : '—';

    const measuresAsc = [...s.measures].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const mStart = measuresAsc[0] || null;
    const mEnd = measuresAsc[measuresAsc.length - 1] || null;

    const measuresDeltaText = deltaLines.length ? escapeHtml(deltaLines.join(' • ')) : '—';

    const weightsRows = weightsAsc.map((w) => `
      <tr>
        <td>${escapeHtml(formatDateTimePtBr(w.dateTimeISO).split(' ')[0])}</td>
        <td>${escapeHtml(formatDateTimePtBr(w.dateTimeISO).split(' ')[1] || '')}</td>
        <td class="cr-num">${escapeHtml(String(Number(w.weightKg).toFixed(1).replace('.', ',')))}</td>
        <td>${w.fasting ? 'Sim' : 'Não'}</td>
        <td>${escapeHtml(w.notes || '')}</td>
      </tr>
    `.trim()).join('');

    const injectionsRows = injectionsAsc.map((i) => `
      <tr>
        <td>${escapeHtml(formatDateTimePtBr(i.dateTimeISO).split(' ')[0])}</td>
        <td>${escapeHtml(formatDateTimePtBr(i.dateTimeISO).split(' ')[1] || '')}</td>
        <td class="cr-num">${escapeHtml(String(Number(i.doseMg).toFixed(1).replace('.', ',')))}</td>
        <td>${escapeHtml(siteLabel(i.site))}</td>
        <td>${escapeHtml(formatSymptomCompact(i.symptoms))}</td>
        <td>${escapeHtml(i.notes || '')}</td>
      </tr>
    `.trim()).join('');

    const measuresRows = measuresAsc.map((m) => `
      <tr>
        <td>${escapeHtml(formatDatePtBr(m.dateISO))}</td>
        <td class="cr-num">${m.waistCm ?? ''}</td>
        <td class="cr-num">${m.hipCm ?? ''}</td>
        <td class="cr-num">${m.armLCm ?? ''}</td>
        <td class="cr-num">${m.armRCm ?? ''}</td>
        <td class="cr-num">${m.thighCm ?? ''}</td>
        <td class="cr-num">${m.calfCm ?? ''}</td>
        <td class="cr-num">${m.chestCm ?? ''}</td>
        <td class="cr-num">${m.neckCm ?? ''}</td>
        <td>${escapeHtml(m.notes || '')}</td>
      </tr>
    `.trim()).join('');

    const symRows = Object.keys(SYMPTOMS_LABELS).map((k) => {
      const mean = symAgg.means?.[k];
      const peak = symAgg.peaks?.[k];
      return `
        <tr>
          <td>${escapeHtml(SYMPTOMS_LABELS[k])}</td>
          <td class="cr-num">${Number.isFinite(mean) ? mean.toFixed(1).replace('.', ',') : '—'}</td>
          <td class="cr-num">${Number.isFinite(peak) ? String(peak) : '—'}</td>
        </tr>
      `.trim();
    }).join('');

    const notesHtml = notes.length
      ? `<ul class="cr-notes">${notes.map((n) => `<li><strong>${escapeHtml(n.kind)}:</strong> ${escapeHtml(formatDateTimePtBr(n.dateTimeISO))} — ${escapeHtml(n.text)}</li>`).join('')}</ul>`
      : '<div class="cr-muted">—</div>';

    return `
      <div class="clinical-report">
        <header class="cr-header">
          <div>
            <div class="cr-title">Relatório de Monitoramento — Retatrutida</div>
            <div class="cr-sub">Gerado em ${escapeHtml(generatedAt)} • Período selecionado: ${rangeDays} dias</div>
          </div>
          <div class="cr-patient">
            <div><strong>Paciente:</strong> ${escapeHtml(patientName || '—')}</div>
            <div class="cr-muted">${patientBirthYear ? `Nasc.: ${escapeHtml(patientBirthYear)}` : '—'}</div>
          </div>
        </header>

        <section class="cr-section">
          <div class="cr-section-title">Regime (informativo)</div>
          <div class="cr-kv">
            <div><span class="cr-k">Medicação:</span> <span class="cr-v">Retatrutida</span></div>
            <div><span class="cr-k">Esquema:</span> <span class="cr-v">semanal (${escapeHtml(formatDowPtBr(injDow))} ${escapeHtml(injTime)})</span></div>
            <div><span class="cr-k">Dose registrada (última):</span> <span class="cr-v">${escapeHtml(doseText)}</span></div>
          </div>
          <div class="cr-muted" style="margin-top:6px;">Histórico de dose (mudanças no período):<br/>${doseHistoryText}</div>
        </section>

        <section class="cr-section">
          <div class="cr-section-title">Resumo executivo</div>
          <div class="cr-grid">
            <div class="cr-box">
              <div class="cr-box-title">Peso</div>
              <div><span class="cr-k">Início → fim:</span> <span class="cr-v">${escapeHtml(wStartText)} → ${escapeHtml(wEndText)}</span></div>
              <div><span class="cr-k">Variação:</span> <span class="cr-v">${escapeHtml(wtDelta)}</span></div>
              <div><span class="cr-k">Média semanal:</span> <span class="cr-v">${escapeHtml(perWeek)}</span></div>
            </div>
            <div class="cr-box">
              <div class="cr-box-title">Consistência (agenda)</div>
              <div><span class="cr-k">Consistência:</span> <span class="cr-v">${adherence.pct}%</span></div>
              <div><span class="cr-k">Pesagens:</span> <span class="cr-v">${adherence.doneWeights}/${adherence.expectedWeights}</span></div>
              <div><span class="cr-k">Aplicações:</span> <span class="cr-v">${adherence.doneInj}/${adherence.expectedInj}</span></div>
            </div>
            <div class="cr-box">
              <div class="cr-box-title">Aplicações</div>
              <div><span class="cr-k">Registros:</span> <span class="cr-v">${s.injections.length}</span></div>
              <div><span class="cr-k">Regularidade (6–8 dias):</span> <span class="cr-v">${escapeHtml(injRate)}</span></div>
              <div class="cr-muted">Última: ${lastInj ? `${escapeHtml(formatDateTimePtBr(lastInj.dateTimeISO))} • ${escapeHtml(formatDoseMg(lastInj.doseMg))} • ${escapeHtml(siteLabel(lastInj.site))}` : '—'}</div>
            </div>
            <div class="cr-box">
              <div class="cr-box-title">Medidas</div>
              <div><span class="cr-k">Registros:</span> <span class="cr-v">${s.measures.length}</span></div>
              <div><span class="cr-k">Delta período:</span> <span class="cr-v">${measuresDeltaText}</span></div>
              <div class="cr-muted">Último: ${lastM ? escapeHtml(formatDatePtBr(lastM.dateISO)) : '—'}</div>
            </div>
          </div>
        </section>

        <section class="cr-section">
          <div class="cr-section-title">Tabela de Pesos</div>
          <table class="cr-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Hora</th>
                <th class="cr-num">Peso (kg)</th>
                <th>Jejum</th>
                <th>Observações</th>
              </tr>
            </thead>
            <tbody>
              ${weightsRows || `<tr><td colspan="5" class="cr-muted">Sem pesos no período.</td></tr>`}
            </tbody>
          </table>
        </section>

        <section class="cr-section">
          <div class="cr-section-title">Tabela de Aplicações</div>
          <table class="cr-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Hora</th>
                <th class="cr-num">Dose (mg)</th>
                <th>Local</th>
                <th>Sintomas (0–10)</th>
                <th>Observações</th>
              </tr>
            </thead>
            <tbody>
              ${injectionsRows || `<tr><td colspan="6" class="cr-muted">Sem aplicações no período.</td></tr>`}
            </tbody>
          </table>
        </section>

        <section class="cr-section">
          <div class="cr-section-title">Medidas</div>
          <div class="cr-muted">Variação do período (início → fim): ${measuresDeltaText}</div>
          <table class="cr-table" style="margin-top:8px;">
            <thead>
              <tr>
                <th>Data</th>
                <th class="cr-num">Cintura</th>
                <th class="cr-num">Quadril</th>
                <th class="cr-num">Braço E</th>
                <th class="cr-num">Braço D</th>
                <th class="cr-num">Coxa</th>
                <th class="cr-num">Panturrilha</th>
                <th class="cr-num">Peito</th>
                <th class="cr-num">Pescoço</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              ${measuresRows || `<tr><td colspan="10" class="cr-muted">Sem medidas no período.</td></tr>`}
            </tbody>
          </table>
        </section>

        <section class="cr-section">
          <div class="cr-section-title">Sintomas agregados (0–10)</div>
          <table class="cr-table cr-table--small">
            <thead>
              <tr>
                <th>Sintoma</th>
                <th class="cr-num">Média</th>
                <th class="cr-num">Pico</th>
              </tr>
            </thead>
            <tbody>
              ${symRows}
            </tbody>
          </table>
        </section>

        <section class="cr-section">
          <div class="cr-section-title">Notas do paciente (últimos registros)</div>
          ${notesHtml}
        </section>

        <footer class="cr-footer">
          <div>Dados auto-relatados pelo paciente via aplicativo (offline-first).</div>
          <div>Este relatório não substitui avaliação médica.</div>
        </footer>
      </div>
    `.trim();
  }

  async function renderReportPreview() {
    if (!reportPreviewEl) return;
    const settings = await getSettings();
    const rangeDays = reportRangeEl?.value ? Number(reportRangeEl.value) : (settings.preferredReportRangeDays || DEFAULTS.preferredReportRangeDays);
    const patientName = reportPatientNameEl?.value || settings.patientName || '';
    const patientBirthYear = settings.patientBirthYear || '';

    const [injections, weights, measures] = await Promise.all([
      getAll(STORE_INJECTIONS),
      getAll(STORE_WEIGHTS),
      getAll(STORE_MEASURES)
    ]);

    reportPreviewEl.innerHTML = buildClinicalReportInnerHtml({
      rangeDays,
      patientName,
      patientBirthYear,
      data: { injections, weights, measures },
      settings
    });
  }

  async function exportReportPdf() {
    const settings = await getSettings();
    const rangeDays = reportRangeEl?.value ? Number(reportRangeEl.value) : (settings.preferredReportRangeDays || DEFAULTS.preferredReportRangeDays);
    const patientName = reportPatientNameEl?.value || settings.patientName || '';
    const patientBirthYear = settings.patientBirthYear || '';

    const [injections, weights, measures] = await Promise.all([
      getAll(STORE_INJECTIONS),
      getAll(STORE_WEIGHTS),
      getAll(STORE_MEASURES)
    ]);

    const inner = buildClinicalReportInnerHtml({
      rangeDays,
      patientName,
      patientBirthYear,
      data: { injections, weights, measures },
      settings
    });

    const win = window.open('', '_blank');
    if (!win) {
      showToast('Bloqueador de pop-up: permita abrir a aba do relatório.');
      return;
    }

    win.document.open();
    win.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Relatório DoseCheck</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; color: #111; }
    .note { background: #f5f7fb; border: 1px solid rgba(0,0,0,.10); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; }

    .clinical-report{ max-width: 960px; margin: 0 auto; }
    .cr-header{ display:flex; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid rgba(0,0,0,.10); }
    .cr-title{ font-size: 18px; font-weight: 900; letter-spacing: -0.01em; }
    .cr-sub{ font-size: 12px; color: #334155; margin-top: 4px; }
    .cr-patient{ text-align: right; font-size: 12px; color:#0f172a; }
    .cr-muted{ color: #475569; font-size: 12px; }
    .cr-section{ margin-top: 14px; }
    .cr-section-title{ font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: .03em; color:#0f172a; margin-bottom: 8px; }
    .cr-kv{ display:grid; grid-template-columns: 1fr; gap: 4px; font-size: 12px; }
    .cr-k{ color:#475569; font-weight: 800; }
    .cr-v{ color:#0f172a; font-weight: 700; }
    .cr-grid{ display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .cr-box{ border: 1px solid rgba(0,0,0,.12); border-radius: 10px; padding: 10px; }
    .cr-box-title{ font-weight: 900; font-size: 13px; margin-bottom: 6px; }
    .cr-table{ width: 100%; border-collapse: collapse; font-size: 12px; }
    .cr-table th, .cr-table td{ border: 1px solid rgba(0,0,0,.12); padding: 6px 8px; vertical-align: top; }
    .cr-table th{ background: #f8fafc; text-align: left; }
    .cr-table--small td, .cr-table--small th{ padding: 6px 8px; }
    .cr-num{ text-align: right; white-space: nowrap; }
    .cr-notes{ margin: 6px 0 0 18px; padding: 0; font-size: 12px; }
    .cr-notes li{ margin: 4px 0; }
    .cr-footer{ margin-top: 18px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,.12); font-size: 11px; color:#475569; }

    @media print {
      @page { size: A4; margin: 14mm; }
      .note { display:none; }
      body { margin: 0; }
      .cr-box, .cr-table, .cr-notes { break-inside: avoid; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="note">Use o menu do navegador/impressão e escolha <strong>Salvar como PDF</strong>.</div>
  ${inner}
  <script>setTimeout(() => { try { window.focus(); window.print(); } catch {} }, 250);<\/script>
</body>
</html>`);
    win.document.close();
  }

  // -----------------------------
  // Resumo p/ IA (texto) - V3
  // -----------------------------

  function formatInsightsSummaryTextFromSummary(summary, settings) {
    const d = Math.max(1, Math.floor(Number(summary?.periodDays) || 30));

    const lines = [];
    lines.push(`Resumo (últimos ${d} dias) — DoseCheck`);
    if (settings?.patientName) {
      lines.push(`Paciente: ${settings.patientName}${settings.patientBirthYear ? ` (nasc. ${settings.patientBirthYear})` : ''}`);
    }
    lines.push('');
    lines.push(`Aplicações: ${summary.injections.count}`);
    lines.push(`Regularidade (6–8 dias): ${summary.injections.onTimeRate === null ? '—' : `${Math.round(summary.injections.onTimeRate * 100)}%`}`);
    lines.push(`Média entre aplicações (dias): ${summary.injections.meanDaysBetween ? summary.injections.meanDaysBetween.toFixed(1).replace('.', ',') : '—'}`);
    lines.push('');
    lines.push(`Pesos: ${summary.weight.count}`);
    lines.push(`Peso início → fim: ${summary.weight.startKg === null ? '—' : summary.weight.startKg.toFixed(1).replace('.', ',')} → ${summary.weight.endKg === null ? '—' : summary.weight.endKg.toFixed(1).replace('.', ',')} kg`);
    lines.push(`Delta: ${Number.isFinite(summary.weight.deltaKg) ? `${summary.weight.deltaKg >= 0 ? '+' : ''}${summary.weight.deltaKg.toFixed(1).replace('.', ',')} kg` : '—'}`);
    lines.push(`Tendência: ${Number.isFinite(summary.weight.perWeekKg) ? `${summary.weight.perWeekKg >= 0 ? '+' : ''}${summary.weight.perWeekKg.toFixed(2).replace('.', ',')} kg/sem` : '—'}`);
    lines.push('');
    lines.push(`Medidas: ${summary.measures.count}`);
    if (summary.measures.deltaByField) {
      const ms = Object.entries(summary.measures.deltaByField)
        .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} cm`)
        .join(' • ');
      lines.push(`Delta (início → fim): ${ms || '—'}`);
    } else {
      lines.push('Delta (início → fim): —');
    }
    lines.push('');
    if (summary.symptoms.averages) {
      const sx = Object.keys(summary.symptoms.averages)
        .map((k) => `${SYMPTOMS_LABELS[k]} ${(summary.symptoms.averages[k] ?? 0).toFixed(1).replace('.', ',')}`)
        .join(' • ');
      lines.push(`Sintomas médios (0–10): ${sx || '—'}`);
    }
    lines.push('');
    lines.push('Observações: sem orientação médica; apenas organização de dados.');
    return lines.join('\n');
  }

  // Requisito: função buildInsightsSummary(days=30)
  async function buildInsightsSummary(days = 30) {
    const settings = await getSettings();
    const d = Math.max(1, Math.floor(Number(days) || 30));
    const [injections, weights, measures] = await Promise.all([
      getAll(STORE_INJECTIONS),
      getAll(STORE_WEIGHTS),
      getAll(STORE_MEASURES)
    ]);

    const summary = buildLastNDaysSummary(d, { injections, weights, measures });
    const prompt = createAiPrompt(summary);
    const text = formatInsightsSummaryTextFromSummary(summary, settings);
    return { days: d, settings, summary, prompt, text };
  }

  async function buildInsightsSummaryText(days = 30) {
    const built = await buildInsightsSummary(days);
    return built.text;
  }

  // -----------------------------
  // Render: Aplicações
  // -----------------------------

  function symptomSummary(sym) {
    if (!sym) return 'Sintomas: —';
    const parts = Object.keys(SYMPTOMS_LABELS).map((k) => `${SYMPTOMS_LABELS[k]} ${sym[k]}`);
    return `Sintomas: ${parts.join(' • ')}`;
  }

  async function renderInjections() {
    const filter = injFilter?.value || '30';
    const injections = await getAll(STORE_INJECTIONS);
    injections.sort(sortByDateTimeDesc);

    const filtered = injections.filter((i) => {
      if (filter === 'all') return true;
      const days = Number(filter);
      return isInLastDays(i.dateTimeISO, days);
    });

    clearChildren(injectionList);
    if (filtered.length === 0) {
      const label = filter === 'all' ? 'Nenhuma aplicação registrada' : `Sem aplicações nos últimos ${filter} dias`;
      renderEmptyState(injectionList, label, 'Toque em "+ Nova" para registrar.');
      return;
    }

    for (const inj of filtered) {
      const item = createEl('div', { class: 'item', role: 'listitem' });
      const main = createEl('div', { class: 'item__main' });

      const title = `${formatDateTimePtBr(inj.dateTimeISO)} • ${formatDoseMg(inj.doseMg)}`;
      main.appendChild(createEl('div', { class: 'item__title' }, title));
      main.appendChild(createEl('div', { class: 'item__meta' }, `${inj.medName} • ${siteLabel(inj.site)}`));
      main.appendChild(createEl('div', { class: 'item__meta' }, symptomSummary(inj.symptoms)));
      if (inj.notes) main.appendChild(createEl('div', { class: 'item__meta' }, `Obs.: ${inj.notes}`));

      item.appendChild(main);

      const actions = createEl('div', { class: 'item__actions' });
      actions.appendChild(createEl('button', {
        class: 'btn btn--secondary',
        type: 'button',
        dataset: { action: 'editInjection', id: inj.id }
      }, 'Editar'));
      actions.appendChild(createEl('button', {
        class: 'btn btn--danger',
        type: 'button',
        dataset: { action: 'deleteInjection', id: inj.id }
      }, 'Excluir'));

      item.appendChild(actions);
      injectionList.appendChild(item);
    }
  }

  // -----------------------------
  // Render: Peso & Medidas
  // -----------------------------

  async function renderWeights() {
    const weights = await getAll(STORE_WEIGHTS);
    weights.sort(sortByDateTimeDesc);

    clearChildren(weightList);
    if (weights.length === 0) {
      renderEmptyState(weightList, 'Nenhum peso registrado', 'Toque em "+ Peso" para adicionar.');
      return;
    }

    for (const w of weights.slice(0, 100)) {
      const item = createEl('div', { class: 'item', role: 'listitem' });
      const main = createEl('div', { class: 'item__main' });

      main.appendChild(createEl('div', { class: 'item__title' }, `${formatKg(w.weightKg)} • ${formatDateTimePtBr(w.dateTimeISO)}`));
      main.appendChild(createEl('div', { class: 'item__meta' }, `${w.fasting ? 'Jejum' : 'Sem jejum'}${w.notes ? ` • Obs.: ${w.notes}` : ''}`));

      item.appendChild(main);

      const actions = createEl('div', { class: 'item__actions' });
      actions.appendChild(createEl('button', {
        class: 'btn btn--secondary',
        type: 'button',
        dataset: { action: 'editWeight', id: w.id }
      }, 'Editar'));
      actions.appendChild(createEl('button', {
        class: 'btn btn--danger',
        type: 'button',
        dataset: { action: 'deleteWeight', id: w.id }
      }, 'Excluir'));

      item.appendChild(actions);
      weightList.appendChild(item);
    }
  }

  function diffLine(label, current, prev) {
    if (current === null || current === undefined || prev === null || prev === undefined) return null;
    const delta = current - prev;
    const sign = delta > 0 ? '+' : '';
    return `${label}: ${formatCm(current)} (${sign}${delta.toFixed(1).replace('.', ',')} cm)`;
  }

  function formatMeasuresCompact(m) {
    const parts = [];
    const add = (label, v) => {
      if (v === null || v === undefined) return;
      parts.push(`${label} ${Number(v).toFixed(1).replace('.', ',')}`);
    };

    add('Cintura', m.waistCm);
    add('Quadril', m.hipCm);
    add('Braço E', m.armLCm);
    add('Braço D', m.armRCm);
    add('Coxa', m.thighCm);
    add('Pant.', m.calfCm);
    add('Peito', m.chestCm);
    add('Pescoço', m.neckCm);

    return parts.length ? parts.join(' • ') : 'Sem valores numéricos.';
  }

  async function renderMeasures() {
    const measures = await getAll(STORE_MEASURES);
    measures.sort(sortByDateDesc);

    // Comparação automática: último vs penúltimo
    if (measuresCompare) {
      if (measures.length >= 2) {
        const a = measures[0];
        const b = measures[1];
        const lines = [
          `Último registro: ${formatDatePtBr(a.dateISO)} (comparado a ${formatDatePtBr(b.dateISO)})`,
          diffLine('Cintura', a.waistCm, b.waistCm),
          diffLine('Quadril', a.hipCm, b.hipCm),
          diffLine('Braço E', a.armLCm, b.armLCm),
          diffLine('Braço D', a.armRCm, b.armRCm),
          diffLine('Coxa', a.thighCm, b.thighCm),
          diffLine('Panturrilha', a.calfCm, b.calfCm),
          diffLine('Peito', a.chestCm, b.chestCm),
          diffLine('Pescoço', a.neckCm, b.neckCm)
        ].filter(Boolean);
        measuresCompare.textContent = lines.join(' • ');
      } else if (measures.length === 1) {
        measuresCompare.textContent = `Último registro: ${formatDatePtBr(measures[0].dateISO)} • Preencha mais um registro para comparar.`;
      } else {
        measuresCompare.textContent = 'Sem medidas registradas ainda.';
      }
    }

    clearChildren(measuresList);
    if (measures.length === 0) {
      renderEmptyState(measuresList, 'Nenhuma medida registrada', 'Toque em "+ Medidas" para adicionar.');
      return;
    }

    for (const m of measures.slice(0, 60)) {
      const item = createEl('div', { class: 'item', role: 'listitem' });
      const main = createEl('div', { class: 'item__main' });

      main.appendChild(createEl('div', { class: 'item__title' }, `${formatDatePtBr(m.dateISO)}`));
      main.appendChild(createEl('div', { class: 'item__meta' }, formatMeasuresCompact(m)));
      if (m.notes) main.appendChild(createEl('div', { class: 'item__meta' }, `Obs.: ${m.notes}`));

      item.appendChild(main);

      const actions = createEl('div', { class: 'item__actions' });
      actions.appendChild(createEl('button', {
        class: 'btn btn--secondary',
        type: 'button',
        dataset: { action: 'editMeasures', id: m.id }
      }, 'Editar'));
      actions.appendChild(createEl('button', {
        class: 'btn btn--danger',
        type: 'button',
        dataset: { action: 'deleteMeasures', id: m.id }
      }, 'Excluir'));

      item.appendChild(actions);
      measuresList.appendChild(item);
    }
  }

  async function renderBody() {
    await Promise.all([renderWeights(), renderMeasures()]);
  }

  // -----------------------------
  // Insights IA (resumo + prompt + mock)
  // -----------------------------

  function safeRatio(numerator, denominator) {
    if (!denominator) return 0;
    return numerator / denominator;
  }

  function computeInjectionRegularity(injectionsDesc) {
    if (injectionsDesc.length < 2) {
      return { count: injectionsDesc.length, meanDays: null, onTimeRate: null, notes: 'Poucos dados para avaliar regularidade.' };
    }

    const times = injectionsDesc
      .map((i) => new Date(i.dateTimeISO))
      .sort((a, b) => a.getTime() - b.getTime());

    const intervals = [];
    for (let i = 1; i < times.length; i++) {
      intervals.push(daysBetween(times[i], times[i - 1]));
    }

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Considerar "no ritmo" se entre 6 e 8 dias.
    const onTime = intervals.filter((d) => d >= 6 && d <= 8).length;
    const onTimeRate = safeRatio(onTime, intervals.length);

    let notes = 'Regularidade dentro do esperado para semanal.';
    if (onTimeRate < 0.5) notes = 'Variação considerável entre aplicações; vale checar rotina/agenda.';

    return { count: injectionsDesc.length, meanDays: mean, onTimeRate, notes };
  }

  function computeWeightTrend(weightsDesc) {
    if (weightsDesc.length < 2) {
      return { start: null, end: null, deltaKg: null, perWeekKg: null, notes: 'Poucos dados de peso.' };
    }

    const asc = [...weightsDesc].sort((a, b) => new Date(a.dateTimeISO) - new Date(b.dateTimeISO));
    const start = asc[0];
    const end = asc[asc.length - 1];

    const startDate = new Date(start.dateTimeISO);
    const endDate = new Date(end.dateTimeISO);
    const days = Math.max(1, daysBetween(endDate, startDate));

    const deltaKg = end.weightKg - start.weightKg;
    const perWeekKg = deltaKg / (days / 7);

    let notes = 'Tendência estável.';
    if (perWeekKg <= -0.2) notes = 'Tendência de queda (bom sinal de consistência, se esse for seu objetivo).';
    if (perWeekKg >= 0.2) notes = 'Tendência de subida (pode ser oscilação, retenção ou alimentação).';

    return { start, end, deltaKg, perWeekKg, notes };
  }

  function computeMeasuresDelta(measuresDesc) {
    if (measuresDesc.length < 2) {
      return { start: null, end: null, deltas: null, notes: 'Poucos dados de medidas.' };
    }

    const asc = [...measuresDesc].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const start = asc[0];
    const end = asc[asc.length - 1];

    const fields = [
      ['waistCm', 'Cintura'],
      ['hipCm', 'Quadril'],
      ['armLCm', 'Braço E'],
      ['armRCm', 'Braço D'],
      ['thighCm', 'Coxa'],
      ['calfCm', 'Panturrilha'],
      ['chestCm', 'Peito'],
      ['neckCm', 'Pescoço']
    ];

    const deltas = {};
    for (const [k, label] of fields) {
      const a = start[k];
      const b = end[k];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      deltas[label] = b - a;
    }

    const keys = Object.keys(deltas);
    let notes = 'Variações pequenas são normais.';
    if (keys.length === 0) notes = 'Sem valores comparáveis no período.';

    return { start, end, deltas, notes };
  }

  function computeCommonSymptoms(injectionsDesc) {
    if (injectionsDesc.length === 0) return { top: [], averages: {} };

    const sums = { nausea: 0, reflux: 0, appetite: 0, energy: 0, bowel: 0 };
    const n = injectionsDesc.length;
    for (const i of injectionsDesc) {
      for (const k of Object.keys(sums)) {
        sums[k] += clampNumber(i.symptoms?.[k] ?? 0, 0, 10);
      }
    }

    const averages = {};
    for (const k of Object.keys(sums)) {
      averages[k] = sums[k] / n;
    }

    const top = Object.keys(averages)
      .map((k) => ({ key: k, label: SYMPTOMS_LABELS[k], avg: averages[k] }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 2);

    return { top, averages };
  }

  function buildLastNDaysSummary(days, data) {
    const d = Math.max(1, Math.floor(Number(days) || 30));
    const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);

    const injectionsN = data.injections.filter((i) => new Date(i.dateTimeISO) >= cutoff).sort(sortByDateTimeDesc);
    const weightsN = data.weights.filter((w) => new Date(w.dateTimeISO) >= cutoff).sort(sortByDateTimeDesc);
    const measuresN = data.measures.filter((m) => {
      const dt = new Date(`${m.dateISO}T00:00:00`);
      return dt >= cutoff;
    }).sort(sortByDateDesc);

    const injReg = computeInjectionRegularity(injectionsN);
    const wtTrend = computeWeightTrend(weightsN);
    const msDelta = computeMeasuresDelta(measuresN);
    const sym = computeCommonSymptoms(injectionsN);

    return {
      periodDays: d,
      injections: {
        count: injectionsN.length,
        meanDaysBetween: injReg.meanDays,
        onTimeRate: injReg.onTimeRate,
        notes: injReg.notes
      },
      weight: {
        count: weightsN.length,
        startKg: wtTrend.start?.weightKg ?? null,
        endKg: wtTrend.end?.weightKg ?? null,
        deltaKg: wtTrend.deltaKg,
        perWeekKg: wtTrend.perWeekKg,
        notes: wtTrend.notes
      },
      measures: {
        count: measuresN.length,
        deltaByField: msDelta.deltas,
        notes: msDelta.notes
      },
      symptoms: {
        top: sym.top,
        averages: sym.averages
      }
    };
  }

  // Requisito: função createAiPrompt(summary)
  function createAiPrompt(summary) {
    const days = Math.max(1, Math.floor(Number(summary?.periodDays) || 30));
    // IMPORTANTE: o prompt explicita limites (sem prescrição de dose/instrução médica)
    // e pede resposta em cards curtos.
    return [
      'Você é um assistente de análise de saúde para um diário de medicação e métricas corporais.',
      'Tarefa: identificar padrões, regularidade, possíveis gatilhos e sugestões de hábitos.',
      'Restrições críticas:',
      '- NÃO prescreva doses, NÃO oriente uso de medicamento, NÃO dê instruções médicas.',
      '- NÃO faça diagnóstico. Não substitui médico.',
      '- Foque em hábitos, consistência, registro e sinais para conversar com profissional.',
      '',
      'Resuma em até 6 cards, cada card com: title, insight, action (curta e prática).',
      'Use linguagem em pt-BR, amigável e sem alarmismo.',
      '',
      `Aqui está o resumo estruturado do período selecionado (${days} dias) (JSON):`,
      JSON.stringify(summary, null, 2)
    ].join('\n');
  }

  async function callAnalyzeEndpoint(payload) {
    // Endpoint esperado: /api/analyze
    // Em servidor estático, isso tende a 404; por isso fazemos fallback.
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`API respondeu ${res.status}`);
    }

    return res.json();
  }

  function mockAnalyze(summary) {
    const days = Math.max(1, Math.floor(Number(summary?.periodDays) || 30));
    // Mock local: resposta em cards com recomendações não-médicas.
    const cards = [];

    const inj = summary.injections;
    if (inj.count === 0) {
      cards.push({
        title: 'Sem aplicações registradas',
        insight: `Não encontrei registros de aplicação nos últimos ${days} dias. Pode ser que você tenha pausado ou só não registrou.`,
        action: 'Se aplicou, registre as datas para melhorar seus insights.'
      });
    } else {
      const rate = inj.onTimeRate === null ? null : Math.round(inj.onTimeRate * 100);
      cards.push({
        title: 'Regularidade',
        insight: `Você registrou ${inj.count} aplicação(ões) nos últimos ${days} dias. ${inj.meanDaysBetween ? `Média de ${inj.meanDaysBetween.toFixed(1).replace('.', ',')} dias entre aplicações.` : ''}`,
        action: rate !== null
          ? `Rotina semanal “no ritmo”: ${rate}% dos intervalos entre 6–8 dias. Ajuste agenda/lembrete se precisar.`
          : 'Registre pelo menos 2 aplicações para avaliar a regularidade.'
      });
    }

    const wt = summary.weight;
    if (wt.count >= 2) {
      const delta = wt.deltaKg;
      const sign = delta > 0 ? '+' : '';
      const perWeek = wt.perWeekKg;
      cards.push({
        title: `Tendência de peso (${days} dias)`,
        insight: `Variação aproximada: ${sign}${delta.toFixed(1).replace('.', ',')} kg (de ${wt.startKg.toFixed(1).replace('.', ',')} para ${wt.endKg.toFixed(1).replace('.', ',')}).`,
        action: `Tendência por semana: ${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(2).replace('.', ',')} kg/semana. Compare sempre em condições parecidas (ex.: jejum).`
      });
    } else {
      cards.push({
        title: 'Peso: dados insuficientes',
        insight: `Com menos de 2 registros de peso em ${days} dias, fica difícil identificar tendência.`,
        action: 'Tente pesar 2–3x por semana (idealmente no mesmo horário/condição).' 
      });
    }

    const ms = summary.measures;
    const d = ms.deltaByField || {};
    const deltaKeys = Object.keys(d);
    if (ms.count >= 2 && deltaKeys.length) {
      const top = deltaKeys
        .map((k) => ({ k, v: d[k] }))
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
        .slice(0, 3)
        .map((x) => `${x.k} ${x.v >= 0 ? '+' : ''}${x.v.toFixed(1).replace('.', ',')} cm`)
        .join(' • ');

      cards.push({
        title: 'Medidas: variações',
        insight: `Principais mudanças (início → fim do período): ${top}.`,
        action: 'Para comparar melhor, use sempre a mesma fita/posição e registre 1x/semana.'
      });
    } else {
      cards.push({
        title: 'Medidas: consistência',
        insight: 'Poucas medidas registradas no período. Oscilações pequenas são normais.',
        action: 'Se fizer sentido, registre medidas 1x por semana para ver tendência.'
      });
    }

    const sym = summary.symptoms;
    if (sym.top && sym.top.length) {
      const [a, b] = sym.top;
      cards.push({
        title: 'Sintomas mais comuns',
        insight: `Médias (0–10): ${a.label} ${a.avg.toFixed(1).replace('.', ',')}${b ? ` • ${b.label} ${b.avg.toFixed(1).replace('.', ',')}` : ''}.`,
        action: 'Anote contexto (sono, horário da refeição, estresse) para encontrar gatilhos.'
      });
    } else {
      cards.push({
        title: 'Sintomas',
        insight: 'Nenhuma aplicação (ou sintomas) registrada no período.',
        action: 'Se for útil, registre sintomas 0–10 por 24–48h após a aplicação.'
      });
    }

    cards.push({
      title: 'Próximo passo (não médico)',
      insight: 'O melhor insight vem de consistência: registros curtos e frequentes.',
      action: 'Defina um lembrete semanal e registre aplicação + peso no mesmo dia sempre que possível.'
    });

    return { cards, disclaimer: 'Análise informativa, não é orientação médica.' };
  }

  function renderInsightsCards(result) {
    clearChildren(insightsCards);

    const disclaimer = result?.disclaimer;
    if (disclaimer) {
      const d = createEl('div', { class: 'item' });
      const main = createEl('div', { class: 'item__main' });
      main.appendChild(createEl('div', { class: 'item__title' }, 'Aviso'));
      main.appendChild(createEl('div', { class: 'item__meta' }, disclaimer));
      d.appendChild(main);
      insightsCards.appendChild(d);
    }

    const cards = result?.cards || [];
    for (const c of cards) {
      const card = createEl('div', { class: 'item' });
      const main = createEl('div', { class: 'item__main' });
      main.appendChild(createEl('div', { class: 'item__title' }, c.title || 'Insight'));
      if (c.insight) main.appendChild(createEl('div', { class: 'item__meta' }, c.insight));
      if (c.action) main.appendChild(createEl('div', { class: 'item__meta' }, `Ação: ${c.action}`));
      card.appendChild(main);
      insightsCards.appendChild(card);
    }

    if (!cards.length) {
      renderEmptyState(insightsCards, 'Sem resposta', 'Tente novamente.');
    }
  }

  async function runInsights() {
    const d = insightsRangeEl?.value ? Math.max(1, Math.floor(Number(insightsRangeEl.value) || 30)) : 30;
    insightsStatus.textContent = `Preparando resumo dos últimos ${d} dias…`;
    clearChildren(insightsCards);

    const built = await buildInsightsSummary(d);
    if (insightsSummaryTextEl) insightsSummaryTextEl.value = built.text;
    const summary = built.summary;
    const prompt = built.prompt;

    insightsStatus.textContent = 'Chamando /api/analyze (fallback local se indisponível)…';

    try {
      const apiResult = await callAnalyzeEndpoint({ prompt, summary });
      insightsStatus.textContent = 'Resposta recebida.';
      renderInsightsCards(apiResult);
    } catch {
      // Mock local
      const mock = mockAnalyze(summary);
      insightsStatus.textContent = 'Modo offline/mock: exibindo análise local.';
      renderInsightsCards(mock);
    }
  }

  function formatTimeHHmmPtBr(dateTimeISO) {
    const d = new Date(dateTimeISO);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // -----------------------------
  // Exportação / Backup / Restore
  // -----------------------------

  function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    if (/[\n\r,\"]/g.test(s)) {
      return `"${s.replace(/\"/g, '""')}"`;
    }
    return s;
  }

  function toCsv(rows, headers) {
    const lines = [];
    lines.push(headers.map(csvEscape).join(','));
    for (const r of rows) {
      lines.push(headers.map((h) => csvEscape(r[h])).join(','));
    }
    return lines.join('\n');
  }

  async function exportJson() {
    const [injections, weights, measures] = await Promise.all([
      getAll(STORE_INJECTIONS),
      getAll(STORE_WEIGHTS),
      getAll(STORE_MEASURES)
    ]);

    const payload = { injections, weights, measures };
    downloadText(`dosecheck-export-${todayStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    showToast('Exportação JSON gerada.');
  }

  async function exportCsv() {
    const [injections, weights, measures] = await Promise.all([
      getAll(STORE_INJECTIONS),
      getAll(STORE_WEIGHTS),
      getAll(STORE_MEASURES)
    ]);

    // Injections CSV
    const injRows = injections
      .sort(sortByDateTimeDesc)
      .map((i) => ({
        id: i.id,
        dateTimeISO: i.dateTimeISO,
        medName: i.medName,
        doseMg: i.doseMg,
        site: i.site,
        nausea: i.symptoms?.nausea ?? 0,
        reflux: i.symptoms?.reflux ?? 0,
        appetite: i.symptoms?.appetite ?? 0,
        energy: i.symptoms?.energy ?? 0,
        bowel: i.symptoms?.bowel ?? 0,
        notes: i.notes || ''
      }));

    const injHeaders = ['id', 'dateTimeISO', 'medName', 'doseMg', 'site', 'nausea', 'reflux', 'appetite', 'energy', 'bowel', 'notes'];
    downloadText(`dosecheck-injections-${todayStamp()}.csv`, toCsv(injRows, injHeaders), 'text/csv;charset=utf-8');

    // Weights CSV
    const wRows = weights
      .sort(sortByDateTimeDesc)
      .map((w) => ({
        id: w.id,
        dateTimeISO: w.dateTimeISO,
        weightKg: w.weightKg,
        fasting: w.fasting,
        notes: w.notes || ''
      }));

    const wHeaders = ['id', 'dateTimeISO', 'weightKg', 'fasting', 'notes'];
    downloadText(`dosecheck-weights-${todayStamp()}.csv`, toCsv(wRows, wHeaders), 'text/csv;charset=utf-8');

    // Measures CSV
    const mRows = measures
      .sort(sortByDateDesc)
      .map((m) => ({
        id: m.id,
        dateISO: m.dateISO,
        waistCm: m.waistCm,
        hipCm: m.hipCm,
        armLCm: m.armLCm,
        armRCm: m.armRCm,
        thighCm: m.thighCm,
        calfCm: m.calfCm,
        chestCm: m.chestCm,
        neckCm: m.neckCm,
        notes: m.notes || ''
      }));

    const mHeaders = ['id', 'dateISO', 'waistCm', 'hipCm', 'armLCm', 'armRCm', 'thighCm', 'calfCm', 'chestCm', 'neckCm', 'notes'];
    downloadText(`dosecheck-measures-${todayStamp()}.csv`, toCsv(mRows, mHeaders), 'text/csv;charset=utf-8');

    showToast('CSVs gerados (3 arquivos).');
  }

  async function exportClinicalCsv() {
    const settings = await getSettings();
    const rangeDays = reportRangeEl?.value
      ? Number(reportRangeEl.value)
      : (settings.preferredReportRangeDays || DEFAULTS.preferredReportRangeDays);
    const d = Math.max(1, Math.floor(Number(rangeDays) || 90));

    const patientName = reportPatientNameEl?.value || settings.patientName || '';
    const patientBirthYear = settings.patientBirthYear || '';
    const exportedAtISO = new Date().toISOString();
    const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);

    const [injections, weights, measures] = await Promise.all([
      getAll(STORE_INJECTIONS),
      getAll(STORE_WEIGHTS),
      getAll(STORE_MEASURES)
    ]);

    const rows = [];

    for (const w of weights) {
      if (new Date(w.dateTimeISO) < cutoff) continue;
      const dateKey = getLocalDateKey(new Date(w.dateTimeISO));
      rows.push({
        exportedAtISO,
        rangeDays: d,
        patientName,
        patientBirthYear,
        recordType: 'weight',
        date: dateKey,
        time: formatTimeHHmmPtBr(w.dateTimeISO),
        weightKg: w.weightKg,
        fasting: w.fasting ? 'S' : 'N',
        medName: '',
        doseMg: '',
        site: '',
        symptoms: '',
        waistCm: '',
        hipCm: '',
        armLCm: '',
        armRCm: '',
        thighCm: '',
        calfCm: '',
        chestCm: '',
        neckCm: '',
        notes: w.notes || ''
      });
    }

    for (const i of injections) {
      if (new Date(i.dateTimeISO) < cutoff) continue;
      const dateKey = getLocalDateKey(new Date(i.dateTimeISO));
      rows.push({
        exportedAtISO,
        rangeDays: d,
        patientName,
        patientBirthYear,
        recordType: 'injection',
        date: dateKey,
        time: formatTimeHHmmPtBr(i.dateTimeISO),
        weightKg: '',
        fasting: '',
        medName: i.medName || '',
        doseMg: i.doseMg,
        site: i.site || '',
        symptoms: formatSymptomCompact(i.symptoms),
        waistCm: '',
        hipCm: '',
        armLCm: '',
        armRCm: '',
        thighCm: '',
        calfCm: '',
        chestCm: '',
        neckCm: '',
        notes: i.notes || ''
      });
    }

    for (const m of measures) {
      const dt = new Date(`${m.dateISO}T00:00:00`);
      if (dt < cutoff) continue;
      rows.push({
        exportedAtISO,
        rangeDays: d,
        patientName,
        patientBirthYear,
        recordType: 'measures',
        date: m.dateISO,
        time: '',
        weightKg: '',
        fasting: '',
        medName: '',
        doseMg: '',
        site: '',
        symptoms: '',
        waistCm: m.waistCm ?? '',
        hipCm: m.hipCm ?? '',
        armLCm: m.armLCm ?? '',
        armRCm: m.armRCm ?? '',
        thighCm: m.thighCm ?? '',
        calfCm: m.calfCm ?? '',
        chestCm: m.chestCm ?? '',
        neckCm: m.neckCm ?? '',
        notes: m.notes || ''
      });
    }

    rows.sort((a, b) => {
      const ak = `${a.date}T${a.time || '00:00'}`;
      const bk = `${b.date}T${b.time || '00:00'}`;
      if (ak === bk) return String(a.recordType).localeCompare(String(b.recordType));
      return ak < bk ? -1 : 1;
    });

    const headers = [
      'exportedAtISO',
      'rangeDays',
      'patientName',
      'patientBirthYear',
      'recordType',
      'date',
      'time',
      'weightKg',
      'fasting',
      'medName',
      'doseMg',
      'site',
      'symptoms',
      'waistCm',
      'hipCm',
      'armLCm',
      'armRCm',
      'thighCm',
      'calfCm',
      'chestCm',
      'neckCm',
      'notes'
    ];

    downloadText(`dosecheck-clinical-${d}d-${todayStamp()}.csv`, toCsv(rows, headers), 'text/csv;charset=utf-8');
    showToast('CSV clínico gerado (1 arquivo).');
  }

  async function downloadBackup() {
    const [injections, weights, measures, settings] = await Promise.all([
      getAll(STORE_INJECTIONS),
      getAll(STORE_WEIGHTS),
      getAll(STORE_MEASURES),
      getSettings()
    ]);

    const payload = {
      version: 1,
      exportedAtISO: new Date().toISOString(),
      settings,
      injections,
      weights,
      measures
    };

    downloadText(`dosecheck-backup-${todayStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    showToast('Backup gerado.');
  }

  function validateBackupShape(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!Array.isArray(obj.injections) || !Array.isArray(obj.weights) || !Array.isArray(obj.measures)) return false;
    return true;
  }

  async function restoreFromFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!validateBackupShape(data)) {
      throw new Error('Arquivo inválido: estrutura não reconhecida.');
    }

    const proceed = confirm('Restaurar este backup substituirá seus dados atuais. Continuar?');
    if (!proceed) return;

    await Promise.all([
      clearStore(STORE_INJECTIONS),
      clearStore(STORE_WEIGHTS),
      clearStore(STORE_MEASURES)
    ]);

    // Importação
    for (const inj of data.injections) {
      if (!inj.id) inj.id = uuid();
      await put(STORE_INJECTIONS, normalizeInjection(inj));
    }
    for (const w of data.weights) {
      if (!w.id) w.id = uuid();
      await put(STORE_WEIGHTS, normalizeWeight(w));
    }
    for (const m of data.measures) {
      if (!m.id) m.id = uuid();
      await put(STORE_MEASURES, normalizeMeasures(m));
    }

    if (data.settings) {
      await saveSettings({
        reminderDow: data.settings.reminderDow ?? DEFAULTS.reminderDow,
        reminderTime: data.settings.reminderTime ?? DEFAULTS.reminderTime,

        injectionDayOfWeek: data.settings.injectionDayOfWeek ?? DEFAULTS.injectionDayOfWeek,
        injectionTime: data.settings.injectionTime ?? DEFAULTS.injectionTime,
        weighDaysOfWeek: data.settings.weighDaysOfWeek ?? DEFAULTS.weighDaysOfWeek,
        measureReminderEveryDays: data.settings.measureReminderEveryDays ?? DEFAULTS.measureReminderEveryDays,

        patientName: data.settings.patientName ?? DEFAULTS.patientName,
        patientBirthYear: data.settings.patientBirthYear ?? DEFAULTS.patientBirthYear,
        preferredReportRangeDays: data.settings.preferredReportRangeDays ?? DEFAULTS.preferredReportRangeDays,

        enableArmSites: data.settings.enableArmSites ?? DEFAULTS.enableArmSites
      });
    }

    showToast('Backup restaurado.');
    await refreshAll();
  }

  async function wipeAll() {
    const proceed = confirm('Tem certeza? Isso apaga aplicações, pesos, medidas e configurações.');
    if (!proceed) return;

    await Promise.all([
      clearStore(STORE_INJECTIONS),
      clearStore(STORE_WEIGHTS),
      clearStore(STORE_MEASURES),
      clearStore(STORE_SETTINGS)
    ]);

    showToast('Dados apagados.');
    await refreshAll();
  }

  // -----------------------------
  // Forms: abrir, preencher, salvar
  // -----------------------------

  async function openInjectionForm(existing = null) {
    const injections = await getAll(STORE_INJECTIONS);
    injections.sort(sortByDateTimeDesc);

    const settings = await getSettings();
    const allowArmOptions = Boolean(settings.enableArmSites) || Boolean(existing?.site?.startsWith('arm_'));
    applyArmSitesVisibility(allowArmOptions);
    const suggestedSite = getNextInjectionSite(injections, settings);

    // Título
    const title = document.getElementById('injTitle');
    title.textContent = existing ? 'Editar aplicação' : 'Registrar aplicação';

    injIdEl.value = existing?.id || '';
    injDateTimeEl.value = existing ? toLocalDateTimeInputValue(new Date(existing.dateTimeISO)) : toLocalDateTimeInputValue(now());
    injMedNameEl.value = existing?.medName || 'Retatrutida';
    injDoseEl.value = existing?.doseMg ?? '';
    injSiteEl.value = existing?.site || suggestedSite;
    injNotesEl.value = existing?.notes || '';

    if (injSiteHintEl) {
      injSiteHintEl.textContent = existing
        ? 'Dica: alternar lados ajuda a manter um rodízio simples.'
        : `Sugestão de rodízio: ${siteLabel(suggestedSite)}.`;
    }

    // Sintomas
    const sym = existing?.symptoms || { nausea: 0, reflux: 0, appetite: 0, energy: 0, bowel: 0 };
    for (const k of Object.keys(symEls)) {
      symEls[k].value = String(sym[k] ?? 0);
      symValEls[k].textContent = String(sym[k] ?? 0);
    }

    injDialog.showModal();
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    dialog.close();
  }

  function clearInjectionForm() {
    injIdEl.value = '';
    injDateTimeEl.value = toLocalDateTimeInputValue(now());
    injMedNameEl.value = 'Retatrutida';
    injDoseEl.value = '';
    injNotesEl.value = '';
    for (const k of Object.keys(symEls)) {
      symEls[k].value = '0';
      symValEls[k].textContent = '0';
    }
  }

  async function saveInjectionFromForm() {
    const dateTimeISO = parseLocalDateTimeInputToISO(injDateTimeEl.value);
    if (!dateTimeISO) throw new Error('Data/hora inválida.');

    const record = normalizeInjection({
      id: injIdEl.value || null,
      dateTimeISO,
      medName: injMedNameEl.value,
      doseMg: injDoseEl.value,
      site: injSiteEl.value,
      symptoms: {
        nausea: Number(symEls.nausea.value),
        reflux: Number(symEls.reflux.value),
        appetite: Number(symEls.appetite.value),
        energy: Number(symEls.energy.value),
        bowel: Number(symEls.bowel.value)
      },
      notes: injNotesEl.value
    });

    if (!Number.isFinite(record.doseMg)) throw new Error('Dose inválida.');

    await put(STORE_INJECTIONS, record);
    showToast(injIdEl.value ? 'Aplicação atualizada.' : 'Aplicação salva.');

    closeDialog(injDialog);
    clearInjectionForm();
    await refreshAll();
  }

  async function openWeightForm(existing = null) {
    const title = document.getElementById('wTitle');
    title.textContent = existing ? 'Editar peso' : 'Registrar peso';

    wIdEl.value = existing?.id || '';
    wDateTimeEl.value = existing ? toLocalDateTimeInputValue(new Date(existing.dateTimeISO)) : toLocalDateTimeInputValue(now());
    wKgEl.value = existing?.weightKg ?? '';
    wFastingEl.value = existing ? String(Boolean(existing.fasting)) : 'true';
    wNotesEl.value = existing?.notes || '';

    wDialog.showModal();
  }

  function clearWeightForm() {
    wIdEl.value = '';
    wDateTimeEl.value = toLocalDateTimeInputValue(now());
    wKgEl.value = '';
    wFastingEl.value = 'true';
    wNotesEl.value = '';
  }

  async function saveWeightFromForm() {
    const dateTimeISO = parseLocalDateTimeInputToISO(wDateTimeEl.value);
    if (!dateTimeISO) throw new Error('Data/hora inválida.');

    const record = normalizeWeight({
      id: wIdEl.value || null,
      dateTimeISO,
      weightKg: wKgEl.value,
      fasting: wFastingEl.value === 'true',
      notes: wNotesEl.value
    });

    if (!Number.isFinite(record.weightKg)) throw new Error('Peso inválido.');

    await put(STORE_WEIGHTS, record);
    showToast(wIdEl.value ? 'Peso atualizado.' : 'Peso salvo.');

    closeDialog(wDialog);
    clearWeightForm();
    await refreshAll();
  }

  async function openMeasuresForm(existing = null) {
    const title = document.getElementById('mTitle');
    title.textContent = existing ? 'Editar medidas' : 'Registrar medidas';

    mIdEl.value = existing?.id || '';
    mDateEl.value = existing ? existing.dateISO : parseDateInputToISO(toLocalDateTimeInputValue(now()).slice(0, 10)) || toLocalDateTimeInputValue(now()).slice(0, 10);

    mWaistEl.value = existing?.waistCm ?? '';
    mHipEl.value = existing?.hipCm ?? '';
    mArmLEl.value = existing?.armLCm ?? '';
    mArmREl.value = existing?.armRCm ?? '';
    mThighEl.value = existing?.thighCm ?? '';
    mCalfEl.value = existing?.calfCm ?? '';
    mChestEl.value = existing?.chestCm ?? '';
    mNeckEl.value = existing?.neckCm ?? '';
    mNotesEl.value = existing?.notes || '';

    mDialog.showModal();
  }

  function clearMeasuresForm() {
    mIdEl.value = '';
    mDateEl.value = toLocalDateTimeInputValue(now()).slice(0, 10);
    mWaistEl.value = '';
    mHipEl.value = '';
    mArmLEl.value = '';
    mArmREl.value = '';
    mThighEl.value = '';
    mCalfEl.value = '';
    mChestEl.value = '';
    mNeckEl.value = '';
    mNotesEl.value = '';
  }

  async function saveMeasuresFromForm() {
    const dateISO = parseDateInputToISO(mDateEl.value);
    if (!dateISO) throw new Error('Data inválida.');

    const record = normalizeMeasures({
      id: mIdEl.value || null,
      dateISO,
      waistCm: mWaistEl.value,
      hipCm: mHipEl.value,
      armLCm: mArmLEl.value,
      armRCm: mArmREl.value,
      thighCm: mThighEl.value,
      calfCm: mCalfEl.value,
      chestCm: mChestEl.value,
      neckCm: mNeckEl.value,
      notes: mNotesEl.value
    });

    await put(STORE_MEASURES, record);
    showToast(mIdEl.value ? 'Medidas atualizadas.' : 'Medidas salvas.');

    closeDialog(mDialog);
    clearMeasuresForm();
    await refreshAll();
  }

  // -----------------------------
  // Ações (delegação)
  // -----------------------------

  async function handleAction(action, id) {
    switch (action) {
      case 'quickAddInjection':
      case 'openInjectionForm':
        await openInjectionForm(null);
        break;
      case 'quickAddWeight':
      case 'openWeightForm':
        await openWeightForm(null);
        break;
      case 'quickAddMeasures':
      case 'openMeasuresForm':
        await openMeasuresForm(null);
        break;
      case 'closeInjDialog':
        closeDialog(injDialog);
        break;
      case 'closeWDialog':
        closeDialog(wDialog);
        break;
      case 'closeMDialog':
        closeDialog(mDialog);
        break;
      case 'clearInjForm':
        clearInjectionForm();
        showToast('Formulário limpo.');
        break;
      case 'clearWForm':
        clearWeightForm();
        showToast('Formulário limpo.');
        break;
      case 'clearMForm':
        clearMeasuresForm();
        showToast('Formulário limpo.');
        break;
      case 'editInjection': {
        const all = await getAll(STORE_INJECTIONS);
        const found = all.find((x) => x.id === id);
        if (found) await openInjectionForm(found);
        break;
      }
      case 'deleteInjection': {
        const ok = confirm('Excluir esta aplicação?');
        if (!ok) return;
        await del(STORE_INJECTIONS, id);
        showToast('Aplicação excluída.');
        await refreshAll();
        break;
      }
      case 'editWeight': {
        const all = await getAll(STORE_WEIGHTS);
        const found = all.find((x) => x.id === id);
        if (found) await openWeightForm(found);
        break;
      }
      case 'deleteWeight': {
        const ok = confirm('Excluir este peso?');
        if (!ok) return;
        await del(STORE_WEIGHTS, id);
        showToast('Peso excluído.');
        await refreshAll();
        break;
      }
      case 'editMeasures': {
        const all = await getAll(STORE_MEASURES);
        const found = all.find((x) => x.id === id);
        if (found) await openMeasuresForm(found);
        break;
      }
      case 'deleteMeasures': {
        const ok = confirm('Excluir estas medidas?');
        if (!ok) return;
        await del(STORE_MEASURES, id);
        showToast('Medidas excluídas.');
        await refreshAll();
        break;
      }
      case 'saveSettings': {
        const route = getRoute();

        if (route === 'settings') {
          await saveSettings(readSettingsFromSettingsView());
          showToast('Configurações salvas.');
          await refreshAll();
          break;
        }

        // Menu (lê apenas lembrete/agendas rápidas)
        await saveSettings({
          reminderDow: reminderDowEl?.value,
          reminderTime: reminderTimeEl?.value || DEFAULTS.reminderTime,
          injectionTime: scheduleInjectionTimeEl?.value || undefined,
          measureReminderEveryDays: scheduleMeasureEveryEl?.value ? Number(scheduleMeasureEveryEl.value) : undefined
        });
        showToast('Configurações salvas.');
        await refreshAll();
        break;
      }
      case 'generateWeeklySummary': {
        const text = await generateWeeklySummary();
        showToast(text ? 'Resumo semanal gerado.' : 'Sem dados suficientes para resumo.');
        break;
      }
      case 'copyWeeklySummary': {
        const text = weeklySummaryTextEl?.value || '';
        await copyTextToClipboard(text);
        break;
      }
      case 'shareWeeklySummary': {
        const text = weeklySummaryTextEl?.value || '';
        await shareText({ title: 'Resumo semanal (DoseCheck)', text });
        break;
      }
      case 'openWeeklySummaryWhatsapp': {
        let text = weeklySummaryTextEl?.value || '';
        if (!text) text = await generateWeeklySummary();
        if (!text) {
          showToast('Sem dados suficientes para resumo.');
          break;
        }
        window.open(whatsappShareUrl(text), '_blank', 'noopener');
        break;
      }
      case 'buildInsightsSummary': {
        const d = insightsRangeEl?.value ? Math.max(1, Math.floor(Number(insightsRangeEl.value) || 30)) : 30;
        const built = await buildInsightsSummary(d);
        if (insightsSummaryTextEl) insightsSummaryTextEl.value = built.text;
        showToast('Resumo montado.');
        break;
      }
      case 'copyInsightsSummary': {
        const text = insightsSummaryTextEl?.value || '';
        await copyTextToClipboard(text);
        break;
      }
      case 'shareInsightsSummary': {
        const text = insightsSummaryTextEl?.value || '';
        await shareText({ title: 'Resumo (DoseCheck)', text });
        break;
      }
      case 'refreshReportPreview':
        await renderReportPreview();
        showToast('Prévia atualizada.');
        break;
      case 'exportReportPdf':
        await exportReportPdf();
        break;
      case 'exportJson':
        await exportJson();
        break;
      case 'exportCsv':
        await exportCsv();
        break;
      case 'exportClinicalCsv':
        await exportClinicalCsv();
        break;
      case 'downloadBackup':
        await downloadBackup();
        break;
      case 'wipeAll':
        await wipeAll();
        break;
      case 'runInsights':
        await runInsights();
        break;
      default:
        break;
    }
  }

  // -----------------------------
  // Refresh global
  // -----------------------------

  async function refreshAll() {
    const route = getRoute();
    await renderReminderBanner();

    // Atualizar configurações no menu
    const s = await getSettings();
    if (reminderDowEl) reminderDowEl.value = s.reminderDow;
    if (reminderTimeEl) reminderTimeEl.value = s.reminderTime;
    if (scheduleInjectionTimeEl) scheduleInjectionTimeEl.value = String(s.injectionTime || DEFAULTS.injectionTime);
    if (scheduleMeasureEveryEl) scheduleMeasureEveryEl.value = String(s.measureReminderEveryDays || DEFAULTS.measureReminderEveryDays);

    if (route === 'dashboard') await renderDashboard();
    if (route === 'injections') await renderInjections();
    if (route === 'body') await renderBody();
    // Insights é sob demanda
    if (route === 'report') {
      if (reportRangeEl && !reportRangeEl.dataset.userTouched) {
        reportRangeEl.value = String(s.preferredReportRangeDays || DEFAULTS.preferredReportRangeDays);
      }
      if (reportPatientNameEl && !reportPatientNameEl.dataset.userTouched) {
        reportPatientNameEl.value = String(s.patientName || '');
      }
      await renderReportPreview();
    }
    if (route === 'settings') {
      await renderSettingsView();
    }
  }

  // -----------------------------
  // Instalação PWA e SW
  // -----------------------------

  let deferredInstallPrompt = null;
  const btnInstall = document.getElementById('btnInstall');

  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (btnInstall) btnInstall.hidden = false;
    });

    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btnInstall.hidden = true;
      });
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');

      // UX moderna: não recarregar automaticamente.
      // Mostra banner e deixa o usuário escolher para não perder inputs/formulários.
      let userAcceptedUpdate = false;
      let refreshing = false;

      const showUpdateBanner = (mode) => {
        if (!bannerUpdate) return;
        const hasWaiting = Boolean(registration.waiting);
        const m = mode || (hasWaiting ? 'waiting' : 'reload');

        if (bannerUpdateText) {
          bannerUpdateText.textContent = m === 'waiting'
            ? 'Atualização disponível. Toque em “Atualizar” para aplicar.'
            : 'Atualização aplicada. Toque em “Atualizar” para recarregar.';
        }
        if (btnUpdateNow) btnUpdateNow.textContent = 'Atualizar';
        if (btnUpdateLater) btnUpdateLater.textContent = 'Depois';
        bannerUpdate.hidden = false;

        // Guarda modo atual no DOM (evita estado global extra)
        bannerUpdate.dataset.mode = m;
      };

      const hideUpdateBanner = () => {
        if (!bannerUpdate) return;
        bannerUpdate.hidden = true;
        delete bannerUpdate.dataset.mode;
      };

      btnUpdateLater?.addEventListener('click', () => {
        hideUpdateBanner();
        showToast('Ok. Você pode atualizar depois.');
      });

      btnUpdateNow?.addEventListener('click', async () => {
        const mode = bannerUpdate?.dataset?.mode || 'waiting';
        userAcceptedUpdate = true;
        hideUpdateBanner();

        if (mode === 'waiting' && registration.waiting) {
          try {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          } catch {
            // se falhar, faz fallback pra recarregar
            location.reload();
          }
          return;
        }

        // Se já ativou, só recarrega.
        location.reload();
      });

      // Se já tem update esperando e já existe controller, avisa.
      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner('waiting');
      }

      // Quando um novo SW for encontrado, ao instalar, oferece a atualização.
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner('waiting');
          }
        });
      });

      // Quando o SW novo assumir: só recarrega se o usuário aceitou.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        if (userAcceptedUpdate) {
          location.reload();
        } else {
          // Se ativou por qualquer motivo, ao menos sugere recarregar.
          showUpdateBanner('reload');
        }
      });
    } catch {
      // Se falhar, o app ainda funciona online.
    }
  }

  // -----------------------------
  // Eventos
  // -----------------------------

  function setupEvents() {
    // Router
    window.addEventListener('hashchange', async () => {
      const route = getRoute();
      showView(route);
      await refreshAll();
    });

    // Menu
    btnOpenMenu?.addEventListener('click', () => {
      menuDialog.showModal();
    });

    // Filtros
    injFilter?.addEventListener('change', () => {
      renderInjections();
    });

    // Relatório: atualizar prévia ao mudar filtros
    reportRangeEl?.addEventListener('change', () => {
      reportRangeEl.dataset.userTouched = 'true';
      if (getRoute() === 'report') renderReportPreview();
    });
    reportPatientNameEl?.addEventListener('input', () => {
      reportPatientNameEl.dataset.userTouched = 'true';
    });

    insightsRangeEl?.addEventListener('change', () => {
      insightsRangeEl.dataset.userTouched = 'true';
    });

    weeklyConsistencyWeekEl?.addEventListener('change', () => {
      if (getRoute() !== 'dashboard') return;
      renderDashboard().catch(() => {});
    });

    // Gráfico: range + tooltip
    weightChartRange30Btn?.addEventListener('click', async () => {
      chartState.rangeDays = 30;
      if (getRoute() !== 'dashboard') return;
      if (chartState.weightsDesc) {
        setChartRangeButtons(30);
        drawWeightChart(weightChartCanvas, chartState.weightsDesc, 30);
        showChartTooltip(null);
      } else {
        await renderWeightChart(30);
      }
    });
    weightChartRange90Btn?.addEventListener('click', async () => {
      chartState.rangeDays = 90;
      if (getRoute() !== 'dashboard') return;
      if (chartState.weightsDesc) {
        setChartRangeButtons(90);
        drawWeightChart(weightChartCanvas, chartState.weightsDesc, 90);
        showChartTooltip(null);
      } else {
        await renderWeightChart(90);
      }
    });

    weightChartCanvas?.addEventListener('click', (e) => {
      const p = findClosestChartPoint(weightChartCanvas, e.clientX, e.clientY);
      showChartTooltip(p);
    });
    weightChartCanvas?.addEventListener('touchstart', (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      const p = findClosestChartPoint(weightChartCanvas, t.clientX, t.clientY);
      showChartTooltip(p);
    }, { passive: true });

    let chartResizeRaf = null;
    window.addEventListener('resize', () => {
      if (getRoute() !== 'dashboard') return;
      if (!weightChartCanvas) return;
      if (chartResizeRaf) cancelAnimationFrame(chartResizeRaf);
      chartResizeRaf = requestAnimationFrame(() => {
        chartResizeRaf = null;
        try {
          if (chartState.weightsDesc) {
            drawWeightChart(weightChartCanvas, chartState.weightsDesc, chartState.rangeDays);
            showChartTooltip(null);
          } else {
            renderWeightChart(chartState.rangeDays);
          }
        } catch {
          // ignore
        }
      });
    });

    // Delegação de ações
    document.addEventListener('click', async (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const action = target.dataset.action;
      const id = target.dataset.id;
      if (!action) return;

      try {
        await handleAction(action, id);
      } catch (err) {
        showToast(String(err?.message || err || 'Erro'));
      }
    });

    // Range values
    for (const k of Object.keys(symEls)) {
      symEls[k]?.addEventListener('input', () => {
        symValEls[k].textContent = String(symEls[k].value);
      });
    }

    // Forms
    injForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await saveInjectionFromForm();
      } catch (err) {
        showToast(String(err?.message || err || 'Erro ao salvar.'));
      }
    });

    wForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await saveWeightFromForm();
      } catch (err) {
        showToast(String(err?.message || err || 'Erro ao salvar.'));
      }
    });

    mForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await saveMeasuresFromForm();
      } catch (err) {
        showToast(String(err?.message || err || 'Erro ao salvar.'));
      }
    });

    // Restore
    restoreFileEl?.addEventListener('change', async () => {
      const file = restoreFileEl.files?.[0];
      if (!file) return;
      try {
        await restoreFromFile(file);
      } catch (err) {
        showToast(String(err?.message || err || 'Falha ao restaurar.'));
      } finally {
        restoreFileEl.value = '';
      }
    });
  }

  // -----------------------------
  // Inicialização
  // -----------------------------

  let checklistIntervalId = null;

  function startChecklistTicker() {
    if (checklistIntervalId) clearInterval(checklistIntervalId);
    checklistIntervalId = setInterval(async () => {
      // Atualiza apenas o que é “tempo-sensível” (avisos/status) sem re-renderizar tudo.
      if (getRoute() !== 'dashboard') return;
      try {
        await renderDashboardChecklist();
      } catch {
        // Silencioso: falhas aqui não devem travar o app.
      }
    }, 60_000);
  }

  async function init() {
    // Garantir rota padrão
    if (!location.hash) location.hash = '#/dashboard';

    showView(getRoute());

    // Pré-preencher datas
    if (injDateTimeEl) injDateTimeEl.value = toLocalDateTimeInputValue(now());
    if (wDateTimeEl) wDateTimeEl.value = toLocalDateTimeInputValue(now());
    if (mDateEl) mDateEl.value = toLocalDateTimeInputValue(now()).slice(0, 10);

    // Carregar settings no menu
    const s = await getSettings();
    reminderDowEl.value = s.reminderDow;
    reminderTimeEl.value = s.reminderTime;
    if (scheduleInjectionTimeEl) scheduleInjectionTimeEl.value = String(s.injectionTime || DEFAULTS.injectionTime);
    if (scheduleMeasureEveryEl) scheduleMeasureEveryEl.value = String(s.measureReminderEveryDays || DEFAULTS.measureReminderEveryDays);

    applyArmSitesVisibility(Boolean(s.enableArmSites));

    setupEvents();
    setupInstallPrompt();
    await registerServiceWorker();

    await refreshAll();

    // Requisito: atualizar automaticamente ao abrir e a cada 1 minuto.
    startChecklistTicker();
  }

  // Boot
  window.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      showToast(String(err?.message || err || 'Erro ao iniciar.'));
    });
  });

  // Expor createAiPrompt no escopo global (facilita testes/integração futura)
  window.createAiPrompt = createAiPrompt;
})();
