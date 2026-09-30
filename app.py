# app.py
"""Nexus AI – Core Engine v2.1

Thin Flask application factory.  All business logic lives in
routes.py, services/, and workflows/.
"""

from flask import Flask

import config
from routes import api_bp


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = config.SECRET_KEY

    # Register the single API blueprint (also serves the index page).
    app.register_blueprint(api_bp)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(
        host=config.APP_HOST,
        port=config.APP_PORT,
        debug=config.FLASK_DEBUG,
        threaded=True,
    )
