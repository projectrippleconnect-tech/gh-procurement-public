# Experimental, no-card hosting candidate for dedicated GH Procurement WAHA.
# WAHA image is intentionally separate from the Next.js/Netlify application.
# Pin an immutable digest after the first verified test build and before production.
FROM devlikeapro/waha:gows
ENV WHATSAPP_DEFAULT_ENGINE=GOWS \
    WAHA_DASHBOARD_ENABLED=false \
    WHATSAPP_SWAGGER_ENABLED=false \
    WAHA_PRINT_QR=False \
    WHATSAPP_RESTART_ALL_SESSIONS=True
EXPOSE 3000
