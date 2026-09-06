from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse

from .config import get_settings
from .ollama import OllamaClient, PROMPT_VERSION
from .paperless import PaperlessClient
from .repository import Repository
from .service import AnalyzerService

settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

repository = Repository(settings.database_url)
paperless = PaperlessClient(settings.paperless_url, settings.paperless_token)
ollama = OllamaClient(
    settings.ollama_url,
    settings.analyzer_model,
    settings.analyzer_request_timeout,
    num_ctx=settings.analyzer_num_ctx,
    num_predict=settings.analyzer_num_predict,
)
service = AnalyzerService(settings, repository, paperless, ollama)
scheduler = BackgroundScheduler(timezone=settings.timezone)
jobs: dict[str, dict[str, Any]] = {}


def run_job(job_id: str, function: Any, **kwargs: Any) -> None:
    jobs[job_id] = {"status": "running", "started_at": datetime.now().isoformat()}
    try:
        jobs[job_id] = {
            **jobs[job_id],
            "status": "finished",
            "result": function(**kwargs),
            "finished_at": datetime.now().isoformat(),
        }
    except Exception as exc:
        logger.exception("Hintergrundauftrag %s fehlgeschlagen", job_id)
        jobs[job_id] = {
            **jobs[job_id],
            "status": "failed",
            "error": str(exc),
            "finished_at": datetime.now().isoformat(),
        }


@asynccontextmanager
async def lifespan(_: FastAPI):
    repository.open()
    repository.migrate()
    recovered = repository.recover_interrupted()
    if recovered:
        logger.warning(
            "%s unterbrochene Dokumentstatus wurden wieder freigegeben",
            recovered,
        )
    pending_presentations = repository.prepare_prompt_upgrade(PROMPT_VERSION)
    if pending_presentations:
        logger.info(
            "%s vorhandene KI-Texte werden schrittweise mit dem verbesserten Prompt erneuert",
            pending_presentations,
        )
    if settings.auto_sync_enabled:
        hour, minute = (int(value) for value in settings.auto_sync_time.split(":"))
        scheduler.add_job(
            service.sync,
            "cron",
            hour=hour,
            minute=minute,
            kwargs={"analyze_new": settings.auto_analyze_new, "limit": settings.batch_limit},
            id="daily_sync",
            replace_existing=True,
            max_instances=1,
        )
        scheduler.start()
    yield
    if scheduler.running:
        scheduler.shutdown(wait=False)
    repository.close()


app = FastAPI(
    title="Digitale Akte",
    version="1.2.4",
    description="Lokaler Paperless- und Ollama-Analyzer",
    lifespan=lifespan,
)


@app.get("/", response_class=HTMLResponse)
def dashboard() -> str:
    return """<!doctype html><html lang='de'><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Digitale Akte</title><style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:2rem}
main{max-width:880px;margin:auto}.card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:1.25rem;margin:1rem 0}
button{background:#22c55e;border:0;border-radius:9px;padding:.75rem 1rem;font-weight:700;cursor:pointer;margin:.25rem}
button.secondary{background:#38bdf8}button.retry{background:#a78bfa}button.danger{background:#f97316}button:disabled{cursor:not-allowed;filter:grayscale(1);opacity:.55}
input{padding:.7rem;border-radius:8px;border:1px solid #64748b;background:#0f172a;color:white;width:10rem}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem}.metric{background:#0f172a;border-radius:12px;padding:1rem}.metric strong{display:block;font-size:1.7rem;margin-top:.25rem}
.bar{height:12px;background:#0f172a;border-radius:999px;overflow:hidden;margin:1rem 0}.bar span{display:block;height:100%;background:#22c55e;width:0;transition:width .4s}
.muted{color:#94a3b8}.running{color:#38bdf8}.failed{color:#f87171}.finished{color:#4ade80}
pre{white-space:pre-wrap;background:#020617;padding:1rem;border-radius:10px;min-height:4rem}a{color:#7dd3fc}
@media(max-width:650px){.metrics{grid-template-columns:1fr}body{padding:1rem}}
</style></head><body><main><h1>Digitale Akte</h1><p>Paperless-Dokumente lokal mit Ollama strukturieren.</p>
<section class='card'><h2>Status</h2><div class='metrics'>
<div class='metric'><span class='muted'>Dokumente</span><strong id='documents'>–</strong></div>
<div class='metric'><span class='muted'>Analysiert</span><strong id='analyzed'>–</strong></div>
<div class='metric'><span class='muted'>Noch offen</span><strong id='pending'>–</strong></div>
<div class='metric'><span class='muted'>Fehlgeschlagen</span><strong id='failed'>–</strong></div>
<div class='metric'><span class='muted'>Ohne OCR</span><strong id='noOcr'>–</strong></div>
<div class='metric'><span class='muted'>Prüfung nötig</span><strong id='review'>–</strong></div></div>
<div class='bar'><span id='bar'></span></div><p id='activity' class='muted'>Status wird geladen …</p>
<small id='updated' class='muted'></small><details><summary>Technische Details</summary><pre id='status'></pre></details></section>
<section class='card'><h2>Aktionen</h2><button class='action' onclick="start('/api/sync?analyze_new=false')">Dokumente importieren</button>
<button class='action secondary' onclick="start('/api/sync?analyze_new=true&limit=25')">25 neue oder alte KI-Texte verbessern</button>
<button class='action secondary' onclick="start('/api/sync?analyze_new=true&repair_ocr=true&limit=5000')">Neue Dokumente + OCR reparieren</button>
<button class='action retry' onclick='retryProblems()'>Fehler + fehlende OCR erneut versuchen</button>
<button class='action danger' onclick='reanalyzeAll()'>Einmalige Komplettanalyse</button><br>
<input id='doc' type='number' min='1' placeholder='Paperless-ID'><button class='action' onclick='one()'>Einzeldokument analysieren</button>
<pre id='result'>Bereit.</pre></section><p><a href='/docs'>API-Dokumentation</a></p></main>
<script>
let activeJob=null;
async function load(){try{let r=await fetch('/api/stats',{cache:'no-store'});let d=await r.json();
let open=Math.max(0,(d.documents??0)-(d.analyzed??0));
document.querySelector('#documents').textContent=d.documents;document.querySelector('#analyzed').textContent=d.analyzed;document.querySelector('#pending').textContent=open;
document.querySelector('#failed').textContent=d.failed??0;document.querySelector('#noOcr').textContent=d.no_ocr??0;document.querySelector('#review').textContent=d.needs_review??0;
let pct=d.documents?Math.round(d.analyzed/d.documents*100):0;document.querySelector('#bar').style.width=pct+'%';
let running=Object.entries(d.jobs).filter(([,j])=>j.status==='running');
let activity=document.querySelector('#activity');
if(running.length){let [id,j]=running[running.length-1];let p=j.progress||{};activity.className='running';activity.textContent='Analyse läuft: '+(p.attempted??0)+' versucht, '+(p.analyzed??0)+' analysiert, '+(p.ocr_recovered??0)+' OCR repariert, '+(p.failed??0)+' fehlgeschlagen – '+id;}
else{activity.className='finished';activity.textContent='Kein Auftrag aktiv. Gesamtfortschritt: '+pct+' %';}
document.querySelectorAll('.action').forEach(b=>b.disabled=running.length>0);
document.querySelector('#status').textContent=JSON.stringify(d,null,2);document.querySelector('#updated').textContent='Automatisch aktualisiert: '+new Date().toLocaleTimeString('de-DE');
if(activeJob&&d.jobs[activeJob]&&d.jobs[activeJob].status!=='running'){document.querySelector('#result').textContent=JSON.stringify(d.jobs[activeJob],null,2);activeJob=null;}
}catch(e){let a=document.querySelector('#activity');a.className='failed';a.textContent='Status konnte nicht geladen werden: '+e;}}
async function start(url){let r=await fetch(url,{method:'POST'});let d=await r.json();activeJob=d.job_id||null;document.querySelector('#result').textContent=JSON.stringify(d,null,2);await load();}
function one(){let id=document.querySelector('#doc').value;if(id)start('/api/analyze/'+id+'?force=true&repair_ocr=true')}
function retryProblems(){if(confirm('Nur fehlgeschlagene Dokumente und Dokumente ohne OCR erneut versuchen?'))start('/api/sync?analyze_new=true&retry_failed=true&repair_ocr=true&limit=5000')}
function reanalyzeAll(){if(confirm('Wirklich alle Dokumente erneut analysieren? Vorhandene Ergebnisse werden dokumentweise ersetzt.'))start('/api/sync?analyze_new=true&force=true&repair_ocr=true&limit=5000')}
load();setInterval(load,3000);
</script></body></html>"""


@app.get("/api/health")
def health() -> JSONResponse:
    checks: dict[str, str] = {}
    for name, check in (
        ("database", repository.ping),
        ("paperless", paperless.ping),
        ("ollama", ollama.ping),
    ):
        try:
            check()
            checks[name] = "ok"
        except Exception as exc:
            checks[name] = f"error: {exc}"
    healthy = all(value == "ok" for value in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "degraded", "checks": checks},
    )


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    return {
        **repository.stats(),
        "jobs": jobs,
        "auto_sync": settings.auto_sync_enabled,
        "app_version": "1.2.4",
        "analysis_version": settings.analysis_version,
        "model": settings.analyzer_model,
        "ocr_reprocess_enabled": settings.ocr_reprocess_enabled,
    }


@app.get("/api/documents")
def documents(
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)
) -> list[dict[str, Any]]:
    return repository.list_documents(limit=limit, offset=offset)


@app.post("/api/sync", status_code=202)
def sync(
    background_tasks: BackgroundTasks,
    analyze_new: bool = False,
    limit: int | None = Query(None, ge=1, le=5000),
    force: bool = False,
    repair_ocr: bool = False,
    retry_failed: bool = False,
) -> dict[str, str]:
    job_id = f"sync-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}"
    effective_limit = limit
    if analyze_new and effective_limit is None:
        effective_limit = settings.batch_limit

    def update_progress(progress: dict[str, Any]) -> None:
        current = jobs.get(job_id)
        if current and current.get("status") == "running":
            current["progress"] = progress

    background_tasks.add_task(
        run_job,
        job_id,
        service.sync,
        analyze_new=analyze_new,
        limit=effective_limit,
        force=force,
        repair_ocr=repair_ocr,
        retry_failed=retry_failed,
        progress=update_progress,
    )
    return {"job_id": job_id, "status": "queued"}


@app.post("/api/analyze/{paperless_id}", status_code=202)
def analyze(
    paperless_id: int,
    background_tasks: BackgroundTasks,
    force: bool = False,
    repair_ocr: bool = True,
) -> dict[str, str]:
    job_id = f"analyze-{paperless_id}-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}"
    background_tasks.add_task(
        run_job,
        job_id,
        service.analyze_one,
        paperless_id=paperless_id,
        force=force,
        repair_ocr=repair_ocr,
    )
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def job(job_id: str) -> dict[str, Any]:
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Auftrag nicht gefunden")
    return jobs[job_id]
