import logging

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ui-server")

app = FastAPI(title="Legacy RapidX AI Dashboard")

LEGACY_UI_DISABLED_MESSAGE = (
    "The legacy Python dashboard is disabled. Use the Next.js dashboard on port 8000."
)


@app.get("/", response_class=HTMLResponse)
async def legacy_dashboard_disabled() -> str:
    return f"""
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Legacy dashboard disabled</title>
        <style>
          body {{
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            font-family: Arial, sans-serif;
            background: #f5f5f4;
            color: #171717;
          }}
          main {{
            width: min(92vw, 560px);
            border: 1px solid #d4d4d4;
            border-radius: 8px;
            background: #fff;
            padding: 24px;
          }}
          p {{
            color: #525252;
            line-height: 1.6;
          }}
        </style>
      </head>
      <body>
        <main>
          <h1>Legacy dashboard disabled</h1>
          <p>{LEGACY_UI_DISABLED_MESSAGE}</p>
        </main>
      </body>
    </html>
    """


@app.get("/api/{_path:path}")
async def legacy_api_disabled(_path: str) -> JSONResponse:
    logger.warning("Blocked request to disabled legacy API path: /api/%s", _path)
    return JSONResponse(
        {"status": "disabled", "message": LEGACY_UI_DISABLED_MESSAGE},
        status_code=410,
    )
