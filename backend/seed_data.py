"""
Demo data generator for Campus Marketplace.

Run it with::

    python app.py --seed      # create tables + demo content
    python -m seed_data       # seed an existing database

The data is deliberately realistic: UNILAFIA departments, Lafia landmarks
(Angwan Rimi, Bukan Sidi, Mararaba, Tudun Amba, Akun…), Nigerian prices in ₦
and a moderation queue that already contains a few pending listings so the
admin dashboard has something to review.
"""

from datetime import datetime, timedelta

from extensions import db
from models import (
    Accommodation,
    Event,
    Favorite,
    Product,
    Review,
    Service,
    User,
)


def _dt(days: int = 0, hours: int = 0) -> datetime:
    """Timestamp ``days`` in the past / future (naive UTC for SQLite)."""
    return datetime.utcnow() + timedelta(days=days, hours=hours)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
USERS = [
    # --- students ---------------------------------------------------------
    dict(
        name="Aisha Bello",
        email="aisha.bello@unilafia.edu.ng",
        phone="08031234567",
        password="Student@123",
        user_type="student",
        verified=True,
        department="Computer Science",
        level="300 Level",
        location="Angwan Rimi, Lafia",
        bio="Computer Science student. I sell fairly used textbooks and gadgets.",
    ),
    dict(
        name="Emeka Okafor",
        email="emeka.okafor@unilafia.edu.ng",
        phone="08067890123",
        password="Student@123",
        user_type="student",
        verified=True,
        department="Economics",
        level="200 Level",
        location="Mararaba, Lafia",
        bio="Economics student • loves football • selling my old laptop.",
    ),
    dict(
        name="Fatima Yusuf",
        email="fatima.yusuf@unilafia.edu.ng",
        phone="07033445566",
        password="Student@123",
        user_type="student",
        verified=False,
        department="Microbiology",
        level="100 Level",
        location="Tudun Amba, Lafia",
        bio="100 Level Microbiology. Looking for affordable hostel space.",
    ),
    dict(
        name="Tunde Adeyemi",
        email="tunde.adeyemi@unilafia.edu.ng",
        phone="09022334455",
        password="Student@123",
        user_type="student",
        verified=True,
        department="Political Science",
        level="400 Level",
        location="Akun, Lafia",
        bio="Final year Political Science. I run a small printing service.",
    ),
    # --- landlords --------------------------------------------------------
    dict(
        name="Mr. Danjuma Attah",
        email="danjuma.attah@gmail.com",
        phone="08123456789",
        password="Landlord@123",
        user_type="landlord",
        verified=True,
        location="Bukan Sidi, Lafia",
        bio="Landlord with 12 years experience around UNILAFIA. Clean rooms, no water issues.",
    ),
    dict(
        name="Mrs. Grace Onah",
        email="grace.onah@gmail.com",
        phone="08055566677",
        password="Landlord@123",
        user_type="landlord",
        verified=True,
        location="Angwan Rimi, Lafia",
        bio="Female-only hostel manager. 24/7 security and steady water supply.",
    ),
    dict(
        name="Alhaji Sule Mai-Angwa",
        email="sule.maiangwa@gmail.com",
        phone="07099001122",
        password="Landlord@123",
        user_type="landlord",
        verified=False,
        location="Mararaba, Lafia",
        bio="Affordable self-contain apartments two minutes from the campus gate.",
    ),
    # --- service providers ------------------------------------------------
    dict(
        name="Blessing Uche",
        email="blessing.uche@unilafia.edu.ng",
        phone="08144556677",
        password="Provider@123",
        user_type="service_provider",
        verified=True,
        department="Mass Communication",
        level="300 Level",
        location="UNILAFIA Hostel",
        bio="Laundry & ironing service. Same-day delivery inside campus.",
    ),
    dict(
        name="Ibrahim Musa",
        email="ibrahim.musa@unilafia.edu.ng",
        phone="09077665544",
        password="Provider@123",
        user_type="service_provider",
        verified=True,
        department="Computer Science",
        level="400 Level",
        location="Faculty of Science",
        bio="Laptop repair, phone screen replacement and software installation.",
    ),
    # --- administrator ----------------------------------------------------
    # Appended last on purpose: the demo rows above and below refer to users by
    # position, so inserting here in front would silently re-point every seller.
    # ``--seed`` only ever runs in development (``app.py`` refuses it under
    # FLASK_ENV=production), and a real deployment still creates its admin
    # explicitly with ``flask --app app create-admin``.
    dict(
        name="UNILAFIA Marketplace Admin",
        email="admin@unilafia.edu.ng",
        phone="08030000000",
        password="Admin@1234",
        user_type="admin",
        verified=True,
        department="Student Affairs",
        location="Administrative Staff, Lafia",
        bio="Reviews listings and settles disputes on the student marketplace.",
    ),
]

# ---------------------------------------------------------------------------
# Products  (status, price, category, owner index, location)
# ---------------------------------------------------------------------------
PRODUCTS = [
    dict(
        seller=0, title="Introduction to Algorithms Textbook (3rd Edition)",
        description="Cormen, Leiserson, Rivest & Stein. Very clean copy, no torn pages or "
                    "highlighting. Perfect for CSC 301 Algorithms and Data Structures.",
        price=8500, category="books", condition="used", status="published",
        location="Angwan Rimi, Lafia", views=142, featured=True, image="books",
    ),
    dict(
        seller=0, title="Scientific Calculator – Casio fx-991ES Plus",
        description="Original Casio, works perfectly for MTH 101, STA 111 and engineering "
                    "courses. Battery just replaced.",
        price=4200, category="electronics", condition="used", status="published",
        location="UNILAFIA Campus", views=96, image="electronics",
    ),
    dict(
        seller=1, title="HP EliteBook 840 G5 Laptop – Core i5, 8GB RAM, 256GB SSD",
        description="Clean UK-used HP EliteBook. Fast boot, strong battery (about 5 hours), "
                    "backlit keyboard. Ideal for programming and assignments. Charger included.",
        price=185000, category="laptops", condition="refurbished", status="published",
        location="Mararaba, Lafia", views=311, featured=True, image="laptops",
    ),
    dict(
        seller=1, title="Tecno Spark 20 Android Phone – 128GB, 8GB RAM",
        description="Selling my Tecno Spark 20. Screen is pristine, slight scratch on the "
                    "back cover. Comes with original charger and box.",
        price=98000, category="phones", condition="used", status="published",
        location="Mararaba, Lafia", views=205, image="phones",
    ),
    dict(
        seller=2, title="Reading Table + Chair Set (Furniture)",
        description="Strong wooden reading table with a matching chair. Bought last session, "
                    "still very solid. Buyer arranges transport from Tudun Amba.",
        price=15000, category="furniture", condition="used", status="published",
        location="Tudun Amba, Lafia", views=74, image="furniture",
    ),
    dict(
        seller=2, title="3-in-1 Rechargeable Reading Lamp",
        description="LED reading lamp with USB charging port and phone holder. Long battery "
                    "life – great for night reading when NEPA takes light.",
        price=6500, category="hostel-essentials", condition="new", status="published",
        location="Tudun Amba, Lafia", views=58, image="hostel-essentials",
    ),
    dict(
        seller=3, title="UNILAFIA Customized Hoodie / Clothing (Size L)",
        description="Navy blue faculty hoodie with the UNILAFIA crest embroidered on the "
                    "chest. Worn twice only, still like new.",
        price=7500, category="clothing", condition="used", status="published",
        location="Akun, Lafia", views=39, image="clothing",
    ),
    dict(
        seller=3, title="CHM 101 & CHM 102 Chemistry Textbook Bundle",
        description="Two chemistry textbooks plus a practical notebook with past questions "
                    "and short notes. Everything a 100L student needs for first semester.",
        price=5000, category="books", condition="used", status="published",
        location="Akun, Lafia", views=88, image="books",
    ),
    dict(
        seller=1, title="Nike Air Force 1 Sneakers (Size 43)",
        description="Original Nike AF1, white. Sole still strong, minor crease on the toe "
                    "box. Selling because I need money for project materials.",
        price=22000, category="clothing", condition="used", status="published",
        location="Mararaba, Lafia", views=51, image="clothing",
    ),
    dict(
        seller=0, title="Student Standing Fan – 18 inch (Ox)",
        description="Ox branded standing fan. Two speeds, no noise, very effective in the "
                    "hostel. Slight rust on the base stand only.",
        price=18000, category="hostel-essentials", condition="used", status="published",
        location="Angwan Rimi, Lafia", views=63, image="hostel-essentials",
    ),
    dict(
        seller=2, title="Past Questions Booklet for 200 Level (GES 201, ECO 201, MTH 202)",
        description="Printed past questions with solutions for GES 201, ECO 201, and MTH 202. "
                    "Spiral bound and very handy for revision.",
        price=2500, category="books", condition="new", status="published",
        location="Tudun Amba, Lafia", views=30, image="books",
    ),
    # --- awaiting moderation ---------------------------------------------
    dict(
        seller=3, title="Rice Cooker – 1.8L (Brand New)",
        description="Brand new 1.8 litre rice cooker. Still sealed in the carton. Hostel "
                    "students cook faster with this.",
        price=16500, category="hostel-essentials", condition="new", status="pending",
        location="Akun, Lafia", views=0, image="hostel-essentials",
    ),
    dict(
        seller=2, title="Bluetooth Speaker – JBL Go 3",
        description="Loud and portable. Charging cable included. Waterproof body, great for "
                    "hostel parties.",
        price=28000, category="electronics", condition="used", status="pending",
        location="Tudun Amba, Lafia", views=0, image="electronics",
    ),
]

# ---------------------------------------------------------------------------
# Accommodation
# ---------------------------------------------------------------------------
ACCOMMODATION = [
    dict(
        landlord=4, title="Single Room (Self-Contain) at Bukan Sidi",
        description="Neat self-contain with private toilet, bathroom and kitchen space. "
                    "Borehole water runs 24/7, prepaid meter, tiled floor and burglary proof. "
                    "Five minutes walk to the main campus gate.",
        location="Bukan Sidi, Lafia", price=180000, rooms=1, room_type="self-contain",
        gender="any", furnished=True, status="published", featured=True, views=420,
        amenities="Water supply, Prepaid meter, Tiled floor, Burglary proof, Private kitchen",
        image="room-selfcontain",
    ),
    dict(
        landlord=4, title="Two Bedroom Flat – Mararaba (Student Friendly)",
        description="Well-fenced two bedroom flat suitable for sharing between two students. "
                    "Parking space, borehole water and a quiet compound.",
        location="Mararaba, Lafia", price=320000, rooms=2, room_type="flat",
        gender="any", furnished=False, status="published", views=268,
        amenities="Fenced compound, Borehole, Parking space, Security gate",
        image="room-flat",
    ),
    dict(
        landlord=5, title="Female-Only Hostel – Angwan Rimi (4 per room)",
        description="Secure female hostel with a matron on ground, CCTV at the entrance and "
                    "steady water. Each student has a personal wardrobe, reading table and bed.",
        location="Angwan Rimi, Lafia", price=120000, rooms=4, room_type="hostel",
        gender="female", furnished=True, status="published", featured=True, views=502,
        amenities="CCTV, Matron, Reading tables, Wardrobes, Borehole water, Generator backup",
        image="room-hostel",
    ),
    dict(
        landlord=5, title="Single Room for Female Students – Tudun Amba",
        description="Quiet compound shared by female students only. Shared kitchen and "
                    "bathroom, water tank and a locked gate by 9pm.",
        location="Tudun Amba, Lafia", price=95000, rooms=1, room_type="single",
        gender="female", furnished=False, status="published", views=180,
        amenities="Water tank, Locked gate, Shared kitchen",
        image="room-single",
    ),
    dict(
        landlord=6, title="Shared Self-Contain – Akun (2 Students)",
        description="Very affordable self-contain to be shared by two students. Newly "
                    "painted, with a borehole in the compound.",
        location="Akun, Lafia", price=70000, rooms=1, room_type="shared",
        gender="any", furnished=False, status="published", views=142,
        amenities="Borehole, New paint, Close to bus stop",
        image="room-shared",
    ),
    dict(
        landlord=6, title="Executive Studio Apartment – Bukan Sidi",
        description="Fully furnished studio with POP ceiling, inverter backup and a private "
                    "balcony. Perfect for a final year student who wants quiet.",
        location="Bukan Sidi, Lafia", price=420000, rooms=1, room_type="self-contain",
        gender="any", furnished=True, status="published", views=97,
        amenities="POP ceiling, Inverter backup, Private balcony, Furnished, Air conditioning",
        image="room-selfcontain",
    ),
    # --- waiting for approval ---------------------------------------------
    dict(
        landlord=6, title="Boys' Hostel Space – Mararaba (New Building)",
        description="Newly built hostel with two students per room, shared bathroom and "
                    "constant water supply. Very close to the faculty of science.",
        location="Mararaba, Lafia", price=85000, rooms=2, room_type="hostel",
        gender="male", furnished=False, status="pending", views=0,
        amenities="New building, Water supply, Tiled floor",
        image="room-hostel",
    ),
]

# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------
EVENTS = [
    dict(
        creator=3, title="UNILAFIA Career & Internship Fair 2026",
        description="Meet recruiters from 25+ organisations, learn how to build a strong CV "
                    "and sit for mock interviews. Free for all students, light refreshment "
                    "provided. Bring copies of your CV.",
        date=_dt(days=9, hours=3), location="Faculty of Science Auditorium",
        category="career", ticket_price=0, status="published", views=210, image="event-career",
    ),
    dict(
        creator=0, title="Inter-Faculty Football Final – Science vs Social Science",
        description="The biggest match of the semester! Come and support your faculty. "
                    "Tickets are ₦500 at the gate, kick-off is 4pm sharp.",
        date=_dt(days=4, hours=6), location="UNILAFIA Sports Complex",
        category="sports", ticket_price=500, status="published", views=388,
        image="event-sports",
    ),
    dict(
        creator=1, title="Nigerian Students' Tech Summit (Campus Edition)",
        description="A one-day summit on AI, data science and freelancing with speakers from "
                    "Abuja tech companies. Certificates will be issued to attendees.",
        date=_dt(days=16, hours=5), location="ICT Centre, UNILAFIA",
        category="academic", ticket_price=2000, status="published", views=174,
        image="event-tech",
    ),
    dict(
        creator=2, title="Campus Praise Night – Gospel Concert",
        description="An evening of worship with the UNILAFIA chapel choir and guest artists. "
                    "Free entry, offering will be collected for the orphanage outreach.",
        date=_dt(days=6, hours=9), location="Chapel of Grace, UNILAFIA",
        category="religious", ticket_price=0, status="published", views=129, image="event-praise",
    ),
    dict(
        creator=1, title="Hostel Movie Night – Block C Common Room",
        description="Free movie night for hostel residents. We are showing a comedy double "
                    "feature. Bring your own popcorn and a chair.",
        date=_dt(days=2, hours=11), location="Hostel Block C Common Room",
        category="entertainment", ticket_price=0, status="published", views=88, image="event-movie",
    ),
    dict(
        creator=3, title="Free CV Writing & LinkedIn Workshop",
        description="Learn how to write a CV that passes ATS screening and optimise your "
                    "LinkedIn profile. Laptops are limited, so come early.",
        date=_dt(days=5, hours=4), location="Faculty of Social Science Hall",
        category="career", ticket_price=0, status="published", views=66, image="event-career",
    ),
    # --- past event (kept for history) ------------------------------------
    dict(
        creator=2, title="Freshers' Orientation Week Closing Party",
        description="Closing party for the 2025/2026 freshers orientation. Live DJ, games "
                    "and a talent showcase.",
        date=_dt(days=-12), location="UNILAFIA Multipurpose Hall",
        category="social", ticket_price=1000, status="published", views=302, image="event-party",
    ),
    # --- awaiting moderation ---------------------------------------------
    dict(
        creator=2, title="Thrift Market & Food Bazaar",
        description="Student entrepreneurs selling affordable clothes, shoes, snacks and "
                    "drinks at the school gate. Vendor slots are still open.",
        date=_dt(days=11, hours=2), location="UNILAFIA Main Gate",
        category="advert", ticket_price=0, status="pending", views=0, image="event-bazaar",
    ),
]

# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------
SERVICES = [
    dict(
        provider=7, title="Same-Day Laundry & Ironing Service",
        description="Wash, dry and iron your clothes within 24 hours. Pickup and delivery "
                    "inside campus and the surrounding hostels at no extra cost. Minimum of "
                    "7 items per order.",
        category="laundry", price=1500, price_unit="per load", status="published",
        location="UNILAFIA Campus", views=158, image="service-laundry",
    ),
    dict(
        provider=7, title="Room Cleaning & Hostel Deep-Clean",
        description="Thorough cleaning of your room, wardrobe and bathroom. Products and "
                    "equipment provided. Weekend slots fill up fast.",
        category="cleaning", price=3000, price_unit="per room", status="published",
        location="Hostels & Angwan Rimi", views=64, image="service-cleaning",
    ),
    dict(
        provider=8, title="Laptop & Phone Repair (Screen, Battery, Software)",
        description="Certified repairs: screen replacement, battery change, motherboard "
                    "faults, keyboard repair, OS installation and virus removal. Free "
                    "diagnosis for students.",
        category="tech-repair", price=2500, price_unit="per job (diagnosis free)",
        status="published", location="Faculty of Science / Bukan Sidi", views=241,
        image="service-repair",
    ),
    dict(
        provider=8, title="Project Typing, Formatting & Printing",
        description="Professional typing of projects and assignments, correct UNILAFIA "
                    "formatting, table of contents, binding and printing. 24-hour delivery "
                    "for urgent work.",
        category="printing", price=250, price_unit="per page", status="published",
        location="ICT Centre, UNILAFIA", views=302, image="service-printing",
    ),
    dict(
        provider=3, title="GES & MTH Tutorial Classes (Small Group)",
        description="Weekend tutorial classes for GES 101, GES 201 and MTH 101. Maximum of "
                    "six students per group so everyone gets attention. Notes included.",
        category="tutoring", price=2000, price_unit="per session", status="published",
        location="Akun, Lafia", views=117, image="service-tutoring",
    ),
    # --- awaiting moderation ---------------------------------------------
    dict(
        provider=7, title="Affordable Barbing & Hair Styling",
        description="Clean cuts and styling for both male and female students. Mobile "
                    "service available if you can't leave your hostel.",
        category="barbing", price=800, price_unit="per cut", status="pending",
        location="Angwan Rimi, Lafia", views=0, image="service-barbing",
    ),
]

# ---------------------------------------------------------------------------
# Reviews  (author, target, rating, comment)
# ---------------------------------------------------------------------------
REVIEWS = [
    (0, 4, 5, "Very honest landlord. The room was exactly as described and the water supply "
              "is truly constant. I renewed for another session."),
    (1, 4, 4, "Good rooms and a peaceful compound. The agent delayed my key by one day but "
              "he apologised and refunded my transport."),
    (2, 5, 5, "Matron is friendly and the hostel is very secure. As a female student I felt "
              "safe from day one."),
    (3, 5, 4, "Clean hostel, but water finishes sometimes in the evening. Still a good place "
              "for the price."),
    (0, 1, 5, "Bought a laptop from Emeka. He allowed me to test everything before paying and "
              "even helped install my software. Trustworthy seller."),
    (3, 7, 5, "Blessing delivered my laundry the same day and everything was neatly ironed. "
              "Highly recommend."),
    (1, 8, 5, "Ibrahim fixed my phone screen in 40 minutes. Very professional and affordable."),
    (0, 8, 4, "Good service. My laptop battery replacement works fine, though it took a "
              "little longer than promised."),
    (2, 3, 5, "Tunde printed and bound my project beautifully and delivered it before the "
              "deadline."),
]


# ---------------------------------------------------------------------------
# Seeder
# ---------------------------------------------------------------------------
def seed_database(app=None) -> dict:
    """Populate the database with demo content (idempotent)."""
    existing = User.query.filter_by(email=USERS[0]["email"]).first()
    if existing:
        _backfill_pending()
        return {"seeded": False, "message": "Demo data already present"}

    # --- users ------------------------------------------------------------
    users: list[User] = []
    for row in USERS:
        user = User(
            name=row["name"],
            email=row["email"],
            phone=row["phone"],
            user_type=row["user_type"],
            verified=row.get("verified", False),
            department=row.get("department"),
            level=row.get("level"),
            location=row.get("location"),
            bio=row.get("bio"),
            created_at=_dt(days=-45 + len(users) * 2),
        )
        user.set_password(row["password"])
        db.session.add(user)
        users.append(user)
    db.session.flush()

    # --- products ---------------------------------------------------------
    products: list[Product] = []
    for row in PRODUCTS:
        product = Product(
            seller_id=users[row["seller"]].id,
            title=row["title"],
            description=row["description"],
            price=row["price"],
            category=row["category"],
            condition=row.get("condition", "used"),
            location=row.get("location"),
            status=row["status"],
            views=row.get("views", 0),
            featured=row.get("featured", False),
            image_url=None,                     # frontend renders a category placeholder
            created_at=_dt(days=-20 + len(products)),
        )
        db.session.add(product)
        products.append(product)

    # --- accommodation ----------------------------------------------------
    rooms: list[Accommodation] = []
    for row in ACCOMMODATION:
        room = Accommodation(
            landlord_id=users[row["landlord"]].id,
            title=row["title"],
            description=row["description"],
            location=row["location"],
            price=row["price"],
            rooms=row["rooms"],
            room_type=row["room_type"],
            gender=row.get("gender", "any"),
            furnished=row.get("furnished", False),
            amenities=row.get("amenities"),
            status=row["status"],
            views=row.get("views", 0),
            featured=row.get("featured", False),
            created_at=_dt(days=-18 + len(rooms)),
        )
        db.session.add(room)
        rooms.append(room)

    # --- events -----------------------------------------------------------
    events: list[Event] = []
    for row in EVENTS:
        event = Event(
            creator_id=users[row["creator"]].id,
            title=row["title"],
            description=row["description"],
            date=row["date"],
            location=row["location"],
            category=row["category"],
            ticket_price=row.get("ticket_price", 0),
            status=row["status"],
            views=row.get("views", 0),
            created_at=_dt(days=-14 + len(events)),
        )
        db.session.add(event)
        events.append(event)

    # --- services ---------------------------------------------------------
    services: list[Service] = []
    for row in SERVICES:
        service = Service(
            provider_id=users[row["provider"]].id,
            title=row["title"],
            description=row["description"],
            category=row["category"],
            price=row["price"],
            price_unit=row.get("price_unit", "per job"),
            location=row.get("location"),
            status=row["status"],
            views=row.get("views", 0),
            created_at=_dt(days=-12 + len(services)),
        )
        db.session.add(service)
        services.append(service)

    # --- reviews ----------------------------------------------------------
    for author_idx, target_idx, rating, comment in REVIEWS:
        db.session.add(
            Review(
                author_id=users[author_idx].id,
                target_id=users[target_idx].id,
                rating=rating,
                comment=comment,
                created_at=_dt(days=-6),
            )
        )

    # --- favourites -------------------------------------------------------
    for user_idx, item_type, item_id in [
        (0, "product", 0), (0, "product", 2), (0, "accommodation", 0),
        (1, "accommodation", 2), (2, "product", 2), (3, "event", 0),
    ]:
        db.session.add(
            Favorite(user_id=users[user_idx].id, item_type=item_type, item_id=item_id)
        )

    db.session.commit()

    summary = {
        "seeded": True,
        "users": len(users),
        "products": len(products),
        "accommodation": len(rooms),
        "events": len(events),
        "services": len(services),
        "reviews": len(REVIEWS),
    }
    print("Demo data inserted:", summary)
    print("\nDemo login details")
    print("  Admin     : admin@unilafia.edu.ng / Admin@1234")
    print("  Student   : aisha.bello@unilafia.edu.ng / Student@123")
    print("  Landlord  : danjuma.attah@gmail.com / Landlord@123")
    print("  Provider  : blessing.uche@unilafia.edu.ng / Provider@123\n")
    return summary


def _backfill_pending() -> None:
    """Ensure the moderation queue is never empty (nice for demos/tests)."""
    if Product.query.filter_by(status="pending").count() == 0:
        product = Product.query.filter_by(status="published").first()
        if product:
            pending = Product(
                seller_id=product.seller_id,
                title="Student Mini Fridge – 45L (Working Perfectly)",
                description="Compact mini fridge, cools very well and is economical on "
                            "electricity. Ideal for keeping drinks and food in the hostel.",
                price=45000,
                category="hostel-essentials",
                condition="used",
                location="Angwan Rimi, Lafia",
                status="pending",
                created_at=_dt(hours=-6),
            )
            db.session.add(pending)
            db.session.commit()


if __name__ == "__main__":       # pragma: no cover - manual helper
    from app import app, bootstrap

    bootstrap(app, reset=True, seed=True)
