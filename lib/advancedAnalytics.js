const INTERNAL_IP_SQL = "ip NOT IN ('::1', '127.0.0.1', '::ffff:127.0.0.1')";

function periodSummary(db, start, end) {
  const visits = db.prepare(`
    SELECT COUNT(*) AS pv, COUNT(DISTINCT NULLIF(fingerprint_id,'')) AS uv,
      COALESCE(ROUND(AVG(NULLIF(stay_duration_ms,0)) / 1000.0,1),0) AS avg_stay,
      COALESCE(ROUND(AVG(NULLIF(max_scroll_depth,0)),1),0) AS avg_scroll
    FROM visitors WHERE tracked_at>=? AND tracked_at<? AND path NOT LIKE '/admin/%' AND ${INTERNAL_IP_SQL} AND COALESCE(is_bot,0)=0
  `).get(start, end);
  const sessions = db.prepare(`
    SELECT COUNT(*) AS sessions, SUM(CASE WHEN page_count<=1 THEN 1 ELSE 0 END) AS bounced
    FROM visitor_sessions vs WHERE start_time>=? AND start_time<?
      AND EXISTS (SELECT 1 FROM visitors v WHERE v.visitor_session_id=vs.id AND v.path NOT LIKE '/admin/%' AND v.${INTERNAL_IP_SQL} AND COALESCE(v.is_bot,0)=0)
  `).get(start, end);
  return { ...visits, sessions: sessions.sessions || 0, bounceRate: sessions.sessions ? Math.round((sessions.bounced || 0) / sessions.sessions * 1000) / 10 : 0 };
}

function delta(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round((current - previous) / previous * 1000) / 10;
}

function getAdvancedAnalytics(db, days = 30, now = Date.now()) {
  const safeDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const duration = safeDays * 86400000;
  const start = now - duration;
  const previousStart = start - duration;
  const current = periodSummary(db, start, now);
  const previous = periodSummary(db, previousStart, start);
  const comparison = {
    pv: delta(current.pv, previous.pv), uv: delta(current.uv, previous.uv),
    sessions: delta(current.sessions, previous.sessions), avgStay: delta(current.avg_stay, previous.avg_stay)
  };

  const sources = db.prepare(`
    SELECT CASE
      WHEN TRIM(COALESCE(utm_source,''))!='' THEN LOWER(TRIM(utm_source))
      WHEN TRIM(COALESCE(referer,''))='' THEN 'direct'
      WHEN LOWER(referer) LIKE '%google.%' OR LOWER(referer) LIKE '%bing.%' OR LOWER(referer) LIKE '%baidu.%' THEN 'organic search'
      ELSE 'referral'
    END AS source, COUNT(*) AS pv, COUNT(DISTINCT NULLIF(fingerprint_id,'')) AS uv
    FROM visitors WHERE tracked_at>=? AND tracked_at<? AND path NOT LIKE '/admin/%' AND ${INTERNAL_IP_SQL} AND COALESCE(is_bot,0)=0
    GROUP BY source ORDER BY pv DESC LIMIT 12
  `).all(start, now);

  const campaigns = db.prepare(`
    SELECT utm_campaign AS campaign, utm_source AS source, utm_medium AS medium,
      COUNT(*) AS pv, COUNT(DISTINCT NULLIF(fingerprint_id,'')) AS uv
    FROM visitors WHERE tracked_at>=? AND tracked_at<? AND path NOT LIKE '/admin/%' AND ${INTERNAL_IP_SQL} AND COALESCE(is_bot,0)=0 AND TRIM(COALESCE(utm_campaign,''))!=''
    GROUP BY utm_campaign,utm_source,utm_medium ORDER BY pv DESC LIMIT 20
  `).all(start, now);

  const transitions = db.prepare(`
    WITH ordered AS (
      SELECT visitor_session_id, path AS to_path,
        LAG(path) OVER (PARTITION BY visitor_session_id ORDER BY tracked_at,id) AS from_path
      FROM visitors WHERE tracked_at>=? AND tracked_at<? AND path NOT LIKE '/admin/%' AND ${INTERNAL_IP_SQL} AND visitor_session_id IS NOT NULL AND COALESCE(is_bot,0)=0
    ) SELECT from_path,to_path,COUNT(*) AS count FROM ordered
      WHERE from_path IS NOT NULL AND from_path!=to_path
      GROUP BY from_path,to_path ORDER BY count DESC LIMIT 15
  `).all(start, now);

  const retention = db.prepare(`
    WITH first_seen AS (
      SELECT fingerprint_id, MIN(tracked_at) AS first_at
      FROM visitors WHERE fingerprint_id!='' AND path NOT LIKE '/admin/%' AND ${INTERNAL_IP_SQL} AND COALESCE(is_bot,0)=0 GROUP BY fingerprint_id
    ) SELECT strftime('%Y-%W', datetime(first_at/1000,'unixepoch','localtime')) AS cohort,
      COUNT(*) AS visitors,
      SUM(CASE WHEN EXISTS(
        SELECT 1 FROM visitors v WHERE v.fingerprint_id=first_seen.fingerprint_id
          AND v.tracked_at>first_seen.first_at+86400000 AND v.tracked_at<=first_seen.first_at+7*86400000
          AND v.path NOT LIKE '/admin/%' AND v.${INTERNAL_IP_SQL} AND COALESCE(v.is_bot,0)=0
      ) THEN 1 ELSE 0 END) AS returned
    FROM first_seen WHERE first_at>=? GROUP BY cohort ORDER BY cohort ASC
  `).all(now - 8 * 7 * 86400000).map((row) => ({ ...row, rate: row.visitors ? Math.round(row.returned / row.visitors * 1000) / 10 : 0 }));

  const content = db.prepare(`
    SELECT path,COUNT(*) AS views,COUNT(DISTINCT NULLIF(fingerprint_id,'')) AS visitors,
      SUM(CASE WHEN stay_duration_ms>=30000 OR max_scroll_depth>=75 THEN 1 ELSE 0 END) AS engaged
    FROM visitors WHERE tracked_at>=? AND tracked_at<? AND ${INTERNAL_IP_SQL} AND COALESCE(is_bot,0)=0 AND path LIKE '/blog/%'
    GROUP BY path ORDER BY views DESC LIMIT 20
  `).all(start, now).map((row) => ({ ...row, engagementRate: row.views ? Math.round(row.engaged / row.views * 1000) / 10 : 0 }));

  const funnelCounts = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN path='/' THEN NULLIF(fingerprint_id,'') END) AS landed,
      COUNT(DISTINCT CASE WHEN path LIKE '/blog/%' OR path LIKE '/works/%' THEN NULLIF(fingerprint_id,'') END) AS content,
      COUNT(DISTINCT CASE WHEN path LIKE '/blog/%' AND (stay_duration_ms>=30000 OR max_scroll_depth>=75) THEN NULLIF(fingerprint_id,'') END) AS engaged
    FROM visitors WHERE tracked_at>=? AND tracked_at<? AND path NOT LIKE '/admin/%' AND ${INTERNAL_IP_SQL} AND COALESCE(is_bot,0)=0
  `).get(start, now);
  const landed = Number(funnelCounts.landed || 0);
  const funnel = [
    { key: 'landed', label: '进入首页', visitors: landed, rate: landed ? 100 : 0 },
    { key: 'content', label: '访问内容', visitors: Number(funnelCounts.content || 0), rate: landed ? Math.round(Number(funnelCounts.content || 0) / landed * 1000) / 10 : 0 },
    { key: 'engaged', label: '深度阅读', visitors: Number(funnelCounts.engaged || 0), rate: landed ? Math.round(Number(funnelCounts.engaged || 0) / landed * 1000) / 10 : 0 }
  ];

  return { days: safeDays, start, end: now, current, previous, comparison, sources, campaigns, transitions, retention, content, funnel };
}

module.exports = { getAdvancedAnalytics, periodSummary, delta };
