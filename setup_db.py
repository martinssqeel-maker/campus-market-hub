import sys
import os

# Add the current directory to the system path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import create_app

print("Connecting to Neon database and creating tables...")
app = create_app()

with app.app_context():
    # Grab the db object DIRECTLY from the initialized app (bypasses import bugs)
    db = app.extensions['sqlalchemy']
    
    db.create_all()
    print("✅ SUCCESS! All Neon tables created with the 500-character image_url limit!")