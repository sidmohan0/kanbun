#!/usr/bin/env python3
"""
Seed Demo Database for Kanbun

Creates a realistic demo database with:
- Multiple jobs (completed, processing, failed)
- Companies with full enrichment data
- Contacts at various pipeline stages
- Activity data (notes, outreach, reminders, stage changes)
- Email templates
- Personal contacts

Usage:
    python scripts/seed_demo_db.py                    # Creates data/demo.db
    python scripts/seed_demo_db.py --output data/kanbun.db  # Specify output path
    python scripts/seed_demo_db.py --clear            # Clear existing data first
"""

import argparse
import asyncio
import json
import random
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import aiosqlite
from app.database import SCHEMA, MIGRATIONS, DEFAULT_TEMPLATE


# =============================================================================
# DEMO DATA - All fictional companies and contacts
# =============================================================================

COMPANIES = [
    {
        "name": "Nimbus Payments",
        "website_url": "https://nimbuspay.example.com",
        "linkedin_url": "https://linkedin.com/company/nimbuspay",
        "meta_title": "Nimbus Payments | Modern Payment Infrastructure",
        "meta_description": "Payment processing built for the modern internet. Nimbus provides APIs and tools for businesses to accept payments globally.",
        "company_description": "Nimbus Payments is a technology company that builds payment infrastructure for the internet. Businesses of every size use their software to accept payments and manage their finances online.",
        "industry": "Financial Technology",
        "headquarters": "Austin, TX",
        "founded_year": "2015",
        "company_size": "500-1000",
        "products_services": "Payment processing, billing, invoicing, fraud prevention, financial reporting",
        "target_customers": "Online businesses, SaaS companies, e-commerce platforms, marketplaces",
        "technologies": '["API-first", "React", "Python", "Go", "AWS"]',
        "keywords": {
            "core_product": ["payment processing", "payment APIs", "billing platform", "subscription management"],
            "category_language": ["fintech", "B2B SaaS", "developer tools", "payment infrastructure"],
            "industry_depth": ["PCI compliance", "card networks", "ACH transfers", "wire transfers"],
            "pain_points": ["payment integration complexity", "international payments", "fraud prevention"],
            "customer_segments": ["startups", "enterprise", "e-commerce", "SaaS companies"]
        }
    },
    {
        "name": "Canopy Workspace",
        "website_url": "https://canopywork.example.com",
        "linkedin_url": "https://linkedin.com/company/canopyworkspace",
        "meta_title": "Canopy - Your connected workspace",
        "meta_description": "A unified tool that combines your everyday work apps into one. The all-in-one workspace for modern teams.",
        "company_description": "Canopy is an all-in-one workspace that combines notes, docs, wikis, and project management. Teams use Canopy to collaborate and stay organized in one place.",
        "industry": "Productivity Software",
        "headquarters": "Seattle, WA",
        "founded_year": "2017",
        "company_size": "200-500",
        "products_services": "Note-taking, wikis, databases, project management, team collaboration",
        "target_customers": "Knowledge workers, product teams, startups, enterprises",
        "technologies": '["React", "TypeScript", "PostgreSQL", "AWS"]',
        "keywords": {
            "core_product": ["workspace", "note-taking", "wiki", "project management", "databases"],
            "category_language": ["productivity", "collaboration", "all-in-one", "connected workspace"],
            "industry_depth": ["blocks", "templates", "integrations", "API"],
            "pain_points": ["tool sprawl", "knowledge silos", "team alignment"],
            "customer_segments": ["startups", "product teams", "engineering teams", "remote teams"]
        }
    },
    {
        "name": "Prism Design",
        "website_url": "https://prismdesign.example.com",
        "linkedin_url": "https://linkedin.com/company/prismdesign",
        "meta_title": "Prism: Collaborative Interface Design",
        "meta_description": "Prism is the leading collaborative design tool for building meaningful products. Design, prototype, and collect feedback seamlessly.",
        "company_description": "Prism is a collaborative web-based design tool used for UI/UX design, prototyping, and design systems. It enables real-time collaboration between designers and stakeholders.",
        "industry": "Design Software",
        "headquarters": "New York, NY",
        "founded_year": "2014",
        "company_size": "500-1000",
        "products_services": "UI design, prototyping, design systems, developer handoff, whiteboarding",
        "target_customers": "Product designers, UX designers, design teams, product managers",
        "technologies": '["WebGL", "TypeScript", "C++", "WebAssembly"]',
        "keywords": {
            "core_product": ["design tool", "prototyping", "design systems", "UI design"],
            "category_language": ["collaborative design", "browser-based", "real-time"],
            "industry_depth": ["auto layout", "components", "variants", "design tokens"],
            "pain_points": ["design handoff", "version control", "design consistency"],
            "customer_segments": ["design teams", "product teams", "agencies", "enterprise"]
        }
    },
    {
        "name": "Velocity PM",
        "website_url": "https://velocitypm.example.com",
        "linkedin_url": "https://linkedin.com/company/velocitypm",
        "meta_title": "Velocity - A better way to build products",
        "meta_description": "Velocity is a purpose-built tool for planning and building products. Streamline issues, projects, and product roadmaps.",
        "company_description": "Velocity is a modern issue tracking and project management tool built for high-performance teams. It focuses on speed, keyboard shortcuts, and a streamlined workflow.",
        "industry": "Project Management",
        "headquarters": "Denver, CO",
        "founded_year": "2019",
        "company_size": "50-100",
        "products_services": "Issue tracking, project management, roadmaps, cycles, triage",
        "target_customers": "Engineering teams, product teams, startups",
        "technologies": '["React", "TypeScript", "GraphQL", "PostgreSQL"]',
        "keywords": {
            "core_product": ["issue tracking", "project management", "roadmaps", "sprints"],
            "category_language": ["modern PM tool", "fast", "keyboard-first"],
            "industry_depth": ["cycles", "triage", "workflows", "automations"],
            "pain_points": ["slow tools", "context switching", "project visibility"],
            "customer_segments": ["engineering teams", "startups", "product teams"]
        }
    },
    {
        "name": "Launchpad Cloud",
        "website_url": "https://launchpadcloud.example.com",
        "linkedin_url": "https://linkedin.com/company/launchpadcloud",
        "meta_title": "Launchpad: Deploy web apps instantly",
        "meta_description": "Launchpad is the platform for frontend developers, providing the speed and reliability innovators need.",
        "company_description": "Launchpad is a cloud platform for frontend developers that enables teams to build, deploy, and scale web applications with zero configuration.",
        "industry": "Cloud Infrastructure",
        "headquarters": "Portland, OR",
        "founded_year": "2016",
        "company_size": "200-500",
        "products_services": "Frontend cloud, edge network, serverless functions, framework support",
        "target_customers": "Frontend developers, web agencies, enterprise teams",
        "technologies": '["Next.js", "React", "Edge Functions", "Rust"]',
        "keywords": {
            "core_product": ["frontend cloud", "deployment platform", "edge network", "serverless"],
            "category_language": ["DX-focused", "serverless", "JAMstack", "edge computing"],
            "industry_depth": ["ISR", "edge functions", "preview deployments", "analytics"],
            "pain_points": ["deployment complexity", "performance optimization", "scaling"],
            "customer_segments": ["frontend developers", "agencies", "enterprise", "startups"]
        }
    },
    {
        "name": "Basecamp DB",
        "website_url": "https://basecampdb.example.com",
        "linkedin_url": "https://linkedin.com/company/basecampdb",
        "meta_title": "Basecamp DB | Open Source Backend Platform",
        "meta_description": "Build production-grade applications with a Postgres database, Authentication, instant APIs, and Realtime features.",
        "company_description": "Basecamp DB is an open-source backend platform providing all the services you need to build a product. Built on top of PostgreSQL with a great developer experience.",
        "industry": "Backend as a Service",
        "headquarters": "Vancouver, BC",
        "founded_year": "2020",
        "company_size": "50-100",
        "products_services": "Database, authentication, storage, realtime subscriptions, edge functions",
        "target_customers": "Full-stack developers, indie hackers, startups, enterprises",
        "technologies": '["PostgreSQL", "Elixir", "TypeScript", "Deno"]',
        "keywords": {
            "core_product": ["backend platform", "PostgreSQL hosting", "authentication", "realtime"],
            "category_language": ["open source", "backend as a service", "developer-first"],
            "industry_depth": ["row level security", "edge functions", "vector embeddings", "branching"],
            "pain_points": ["backend complexity", "scaling databases", "auth implementation"],
            "customer_segments": ["indie developers", "startups", "enterprises", "agencies"]
        }
    },
    {
        "name": "Courier Mail",
        "website_url": "https://couriermail.example.com",
        "linkedin_url": "https://linkedin.com/company/couriermail",
        "meta_title": "Courier - Email for developers",
        "meta_description": "The best way to reach humans instead of spam folders. Build, test, and deliver transactional emails at scale.",
        "company_description": "Courier is a modern email API built for developers. It provides a simple way to send transactional emails with high deliverability and great developer experience.",
        "industry": "Email Infrastructure",
        "headquarters": "Boston, MA",
        "founded_year": "2021",
        "company_size": "10-50",
        "products_services": "Email API, React Email, email analytics, domain management",
        "target_customers": "Developers, SaaS companies, startups",
        "technologies": '["React", "TypeScript", "AWS SES", "Rust"]',
        "keywords": {
            "core_product": ["email API", "transactional email", "email delivery"],
            "category_language": ["developer-first", "modern email", "API-first"],
            "industry_depth": ["SPF", "DKIM", "deliverability", "email templates"],
            "pain_points": ["email deliverability", "spam filters", "email testing"],
            "customer_segments": ["developers", "SaaS startups", "product teams"]
        }
    },
    {
        "name": "Screencast Pro",
        "website_url": "https://screencastpro.example.com",
        "linkedin_url": "https://linkedin.com/company/screencastpro",
        "meta_title": "Screencast Pro: Async Video for Work",
        "meta_description": "Record and share video messages of your screen, cam, or both. Faster than typing, more personal than email.",
        "company_description": "Screencast Pro is a video messaging platform that helps teams communicate faster with instant video. Record your screen and camera, then share with a link.",
        "industry": "Video Communication",
        "headquarters": "Miami, FL",
        "founded_year": "2016",
        "company_size": "100-200",
        "products_services": "Screen recording, video messaging, video analytics, transcription",
        "target_customers": "Remote teams, sales teams, customer success, educators",
        "technologies": '["React", "WebRTC", "AWS", "TypeScript"]',
        "keywords": {
            "core_product": ["video messaging", "screen recording", "async video"],
            "category_language": ["async communication", "video for work", "remote collaboration"],
            "industry_depth": ["transcription", "video analytics", "CTA buttons", "embedding"],
            "pain_points": ["meeting overload", "async communication", "explaining visually"],
            "customer_segments": ["remote teams", "sales", "customer success", "product teams"]
        }
    },
    {
        "name": "GridBase",
        "website_url": "https://gridbase.example.com",
        "linkedin_url": "https://linkedin.com/company/gridbase",
        "meta_title": "GridBase | Build apps without code",
        "meta_description": "GridBase is a platform to build apps faster. Move beyond rigid tools and create apps that power your workflows.",
        "company_description": "GridBase is a low-code platform that combines the simplicity of a spreadsheet with the power of a database. Teams use it to build custom apps and workflows.",
        "industry": "Low-Code Platform",
        "headquarters": "Chicago, IL",
        "founded_year": "2013",
        "company_size": "200-500",
        "products_services": "Relational databases, automations, interfaces, extensions, API",
        "target_customers": "Operations teams, product teams, marketing teams, enterprises",
        "technologies": '["React", "Node.js", "PostgreSQL", "AWS"]',
        "keywords": {
            "core_product": ["database platform", "low-code", "workflow automation"],
            "category_language": ["spreadsheet-database hybrid", "no-code", "app builder"],
            "industry_depth": ["views", "automations", "interfaces", "syncs"],
            "pain_points": ["spreadsheet limitations", "workflow automation", "data management"],
            "customer_segments": ["operations", "marketing", "product", "enterprise"]
        }
    },
    {
        "name": "BuildKit",
        "website_url": "https://buildkit.example.com",
        "linkedin_url": "https://linkedin.com/company/buildkit",
        "meta_title": "BuildKit | Internal tools, fast",
        "meta_description": "Build internal tools remarkably fast. BuildKit is visual programming meets the power of real code.",
        "company_description": "BuildKit is a low-code platform for building internal tools. It connects to any database or API and lets teams build dashboards, admin panels, and CRUD apps quickly.",
        "industry": "Internal Tools",
        "headquarters": "Salt Lake City, UT",
        "founded_year": "2018",
        "company_size": "100-200",
        "products_services": "Internal tool builder, database GUI, workflow automation, mobile apps",
        "target_customers": "Engineering teams, operations teams, data teams",
        "technologies": '["React", "TypeScript", "PostgreSQL", "Docker"]',
        "keywords": {
            "core_product": ["internal tools", "admin panels", "dashboards", "CRUD apps"],
            "category_language": ["low-code", "visual programming", "rapid development"],
            "industry_depth": ["SQL GUI", "REST API", "GraphQL", "custom components"],
            "pain_points": ["internal tool maintenance", "developer time", "operational efficiency"],
            "customer_segments": ["engineering", "operations", "data teams", "enterprise"]
        }
    },
    {
        "name": "Beacon Analytics",
        "website_url": "https://beaconanalytics.example.com",
        "linkedin_url": "https://linkedin.com/company/beaconanalytics",
        "meta_title": "Beacon - Product Analytics Platform",
        "meta_description": "Beacon is the all-in-one platform for building better products - with analytics, feature flags, A/B testing, and session replay.",
        "company_description": "Beacon is an open-source product analytics platform. It provides everything product teams need to understand user behavior - analytics, session replay, feature flags, and experiments.",
        "industry": "Product Analytics",
        "headquarters": "Berlin, Germany",
        "founded_year": "2020",
        "company_size": "50-100",
        "products_services": "Product analytics, session replay, feature flags, A/B testing, surveys",
        "target_customers": "Product teams, engineers, growth teams, startups",
        "technologies": '["React", "Python", "ClickHouse", "Kafka"]',
        "keywords": {
            "core_product": ["product analytics", "session replay", "feature flags", "A/B testing"],
            "category_language": ["open source", "self-hosted", "all-in-one", "product intelligence"],
            "industry_depth": ["funnels", "retention", "cohorts", "autocapture"],
            "pain_points": ["data silos", "tool fragmentation", "privacy compliance"],
            "customer_segments": ["product teams", "engineers", "startups", "enterprise"]
        }
    },
    {
        "name": "AuthStack",
        "website_url": "https://authstack.example.com",
        "linkedin_url": "https://linkedin.com/company/authstack",
        "meta_title": "AuthStack | Drop-in Authentication",
        "meta_description": "AuthStack is a complete suite of embeddable UIs, flexible APIs, and admin dashboards for user authentication.",
        "company_description": "AuthStack provides drop-in authentication and user management for modern applications. It handles sign-up, sign-in, user profiles, and organization management out of the box.",
        "industry": "Authentication",
        "headquarters": "Toronto, ON",
        "founded_year": "2021",
        "company_size": "20-50",
        "products_services": "Authentication, user management, organizations, OAuth, MFA",
        "target_customers": "Frontend developers, startups, SaaS companies",
        "technologies": '["React", "Next.js", "TypeScript", "PostgreSQL"]',
        "keywords": {
            "core_product": ["authentication", "user management", "SSO", "MFA"],
            "category_language": ["drop-in auth", "embeddable UI", "developer-first"],
            "industry_depth": ["JWT", "OAuth", "SAML", "organizations"],
            "pain_points": ["auth complexity", "security best practices", "user experience"],
            "customer_segments": ["developers", "startups", "SaaS companies", "agencies"]
        }
    },
]

CONTACTS_DATA = [
    # Nimbus Payments contacts
    {"company": "Nimbus Payments", "first_name": "Marcus", "last_name": "Chen", "title": "CEO", "email": "marcus@nimbuspay.example.com", "stage": "meeting"},
    {"company": "Nimbus Payments", "first_name": "Diana", "last_name": "Ross", "title": "COO", "email": "diana@nimbuspay.example.com", "stage": "engaged"},
    {"company": "Nimbus Payments", "first_name": "Raj", "last_name": "Patel", "title": "CTO", "email": "raj@nimbuspay.example.com", "stage": "contacted"},
    # Canopy Workspace contacts
    {"company": "Canopy Workspace", "first_name": "Elena", "last_name": "Volkov", "title": "CEO", "email": "elena@canopywork.example.com", "stage": "engaged"},
    {"company": "Canopy Workspace", "first_name": "James", "last_name": "Wright", "title": "COO", "email": "james@canopywork.example.com", "stage": "reaching_out"},
    # Prism Design contacts
    {"company": "Prism Design", "first_name": "Sophie", "last_name": "Laurent", "title": "CEO", "email": "sophie@prismdesign.example.com", "stage": "won"},
    {"company": "Prism Design", "first_name": "Kevin", "last_name": "Nakamura", "title": "VP Product", "email": "kevin@prismdesign.example.com", "stage": "meeting"},
    # Velocity PM contacts
    {"company": "Velocity PM", "first_name": "Anna", "last_name": "Kowalski", "title": "CEO", "email": "anna@velocitypm.example.com", "stage": "engaged"},
    {"company": "Velocity PM", "first_name": "Tom", "last_name": "Fischer", "title": "CTO", "email": "tom@velocitypm.example.com", "stage": "backlog"},
    # Launchpad Cloud contacts
    {"company": "Launchpad Cloud", "first_name": "Miguel", "last_name": "Santos", "title": "CEO", "email": "miguel@launchpadcloud.example.com", "stage": "contacted"},
    {"company": "Launchpad Cloud", "first_name": "Rachel", "last_name": "Kim", "title": "VP Engineering", "email": "rachel@launchpadcloud.example.com", "stage": "reaching_out"},
    # Basecamp DB contacts
    {"company": "Basecamp DB", "first_name": "Oliver", "last_name": "Thompson", "title": "CEO", "email": "oliver@basecampdb.example.com", "stage": "meeting"},
    {"company": "Basecamp DB", "first_name": "Priya", "last_name": "Sharma", "title": "CTO", "email": "priya@basecampdb.example.com", "stage": "backlog"},
    # Courier Mail contacts
    {"company": "Courier Mail", "first_name": "Lucas", "last_name": "Andersen", "title": "CEO", "email": "lucas@couriermail.example.com", "stage": "lost"},
    # Screencast Pro contacts
    {"company": "Screencast Pro", "first_name": "Emma", "last_name": "Davis", "title": "CEO", "email": "emma@screencastpro.example.com", "stage": "naf"},
    {"company": "Screencast Pro", "first_name": "Chris", "last_name": "Miller", "title": "CTO", "email": "chris@screencastpro.example.com", "stage": "backlog"},
    # GridBase contacts
    {"company": "GridBase", "first_name": "Sarah", "last_name": "O'Brien", "title": "CEO", "email": "sarah@gridbase.example.com", "stage": "reaching_out"},
    {"company": "GridBase", "first_name": "David", "last_name": "Lee", "title": "CPO", "email": "david@gridbase.example.com", "stage": "backlog"},
    # BuildKit contacts
    {"company": "BuildKit", "first_name": "Jennifer", "last_name": "Martinez", "title": "CEO", "email": "jennifer@buildkit.example.com", "stage": "engaged"},
    # Beacon Analytics contacts
    {"company": "Beacon Analytics", "first_name": "Alex", "last_name": "Mueller", "title": "CEO", "email": "alex@beaconanalytics.example.com", "stage": "contacted"},
    {"company": "Beacon Analytics", "first_name": "Nina", "last_name": "Petrov", "title": "CTO", "email": "nina@beaconanalytics.example.com", "stage": "backlog"},
    # AuthStack contacts
    {"company": "AuthStack", "first_name": "Ryan", "last_name": "Burke", "title": "CEO", "email": "ryan@authstack.example.com", "stage": "backlog"},
    {"company": "AuthStack", "first_name": "Amy", "last_name": "Chen", "title": "CTO", "email": "amy@authstack.example.com", "stage": "backlog"},
]

PERSONAL_CONTACTS = [
    {"first_name": "Jordan", "last_name": "Rivera", "email": "jordan.rivera@example.com", "phone": "+1 (555) 123-4567", "relationship": "friend", "notes": "Met at Tech Summit 2023. Interested in developer tools."},
    {"first_name": "Taylor", "last_name": "Brooks", "email": "t.brooks@example.com", "phone": "+1 (555) 234-5678", "relationship": "acquaintance", "notes": "Connected at a meetup. Works in cloud infrastructure."},
    {"first_name": "Morgan", "last_name": "Hayes", "email": "morgan.h@example.com", "phone": "+1 (555) 345-6789", "relationship": "family", "notes": "Cousin. Works as a software architect."},
]

EMAIL_TEMPLATES = [
    {
        "name": "Follow-up After Meeting",
        "category": "Follow-ups",
        "subject": "Great meeting, {{first_name}}!",
        "body": """Hi {{first_name}},

Thanks for taking the time to chat today. I really enjoyed learning more about what you're building at {{company_name}}.

As discussed, here are the next steps:
- [Action item 1]
- [Action item 2]

Let me know if you have any questions!

Best,
[Your name]"""
    },
    {
        "name": "Demo Request",
        "category": "Cold Outreach",
        "subject": "Quick demo for {{company_name}}?",
        "body": """Hi {{first_name}},

I noticed {{company_name}} is doing interesting work in [area]. We help similar companies [value proposition].

Would you be open to a quick 15-minute demo this week?

Best,
[Your name]"""
    },
    {
        "name": "Re-engagement",
        "category": "Follow-ups",
        "subject": "Checking in, {{first_name}}",
        "body": """Hi {{first_name}},

It's been a while since we last connected. I wanted to check in and see how things are going at {{company_name}}.

We've made some exciting updates since we last spoke that I think could be relevant for your team.

Would you have 15 minutes to catch up this week?

Best,
[Your name]"""
    },
    {
        "name": "Referral Request",
        "category": "Networking",
        "subject": "Quick favor, {{first_name}}?",
        "body": """Hi {{first_name}},

Hope you're doing well! I'm reaching out because I'm trying to connect with [target company/person] and noticed you might know them.

Would you be comfortable making an intro? Happy to send over a blurb you can forward.

Thanks so much!
[Your name]"""
    },
    {
        "name": "Thank You Note",
        "category": "Follow-ups",
        "subject": "Thank you!",
        "body": """Hi {{first_name}},

I just wanted to send a quick note to thank you for [specific thing]. It really means a lot.

Looking forward to staying in touch!

Best,
[Your name]"""
    },
]

OUTREACH_NOTES = [
    "Discussed their current tech stack and pain points. Very interested in our solution.",
    "Left voicemail, will follow up via email.",
    "Connected on LinkedIn, sent intro message.",
    "Had a great call. They're evaluating options for Q1.",
    "Sent product overview and case study.",
    "Scheduled demo for next week.",
    "Met at conference, exchanged cards.",
    "Intro call went well, moving to technical deep-dive.",
]

CONTACT_NOTE_TEMPLATES = [
    "Key decision maker. Reports directly to CEO.",
    "Previously worked at a competitor. Good technical background.",
    "Prefers async communication. Very responsive on email.",
    "Budget approved for Q1. Need to move fast.",
    "Introduced by a mutual connection. Warm lead.",
    "Mentioned they're unhappy with current solution.",
    "Technical buyer - will need to see documentation.",
    "Has influence over purchasing but not final decision maker.",
]

COMPANY_NOTE_TEMPLATES = [
    "Series B funded, growing quickly. Good timing for our product.",
    "Competitor to another prospect. Could be strategic partnership opportunity.",
    "Recently announced expansion to Europe. May need localization.",
    "Strong engineering culture. Will appreciate technical depth.",
    "Just raised funding - likely have budget allocated.",
    "Multiple contacts engaged. Need to coordinate approach.",
]


# =============================================================================
# SEED FUNCTIONS
# =============================================================================

async def create_database(db_path: str, clear: bool = False):
    """Initialize the database with schema."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    if clear and Path(db_path).exists():
        Path(db_path).unlink()
        print(f"Cleared existing database: {db_path}")

    async with aiosqlite.connect(db_path) as db:
        await db.executescript(SCHEMA)
        await db.commit()

        # Run migrations
        for migration in MIGRATIONS:
            try:
                await db.execute(migration)
                await db.commit()
            except Exception:
                pass

    print(f"Database initialized: {db_path}")


async def seed_jobs(db_path: str) -> dict:
    """Create demo jobs and return job IDs."""
    jobs = [
        {
            "id": str(uuid.uuid4()),
            "filename": "tech-companies-q1.csv",
            "status": "completed",
            "total_companies": len(COMPANIES),
            "processed_count": len(COMPANIES),
            "created_at": (datetime.now() - timedelta(days=7)).isoformat(),
            "completed_at": (datetime.now() - timedelta(days=7, hours=-2)).isoformat(),
        },
        {
            "id": str(uuid.uuid4()),
            "filename": "saas-leads-batch2.csv",
            "status": "completed",
            "total_companies": 5,
            "processed_count": 5,
            "created_at": (datetime.now() - timedelta(days=3)).isoformat(),
            "completed_at": (datetime.now() - timedelta(days=3, hours=-1)).isoformat(),
        },
    ]

    async with aiosqlite.connect(db_path) as db:
        for job in jobs:
            await db.execute(
                """INSERT INTO jobs (id, filename, status, total_companies, processed_count, created_at, completed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (job["id"], job["filename"], job["status"], job["total_companies"],
                 job["processed_count"], job["created_at"], job["completed_at"])
            )
        await db.commit()

    print(f"Created {len(jobs)} jobs")
    return {"main_job": jobs[0]["id"], "secondary_job": jobs[1]["id"]}


async def seed_companies(db_path: str, job_id: str) -> dict:
    """Create demo companies and return company ID mapping."""
    company_ids = {}

    async with aiosqlite.connect(db_path) as db:
        for company in COMPANIES:
            company_id = str(uuid.uuid4())
            company_ids[company["name"]] = company_id

            await db.execute(
                """INSERT INTO companies
                   (id, job_id, name, website_url, linkedin_url, status,
                    meta_title, meta_description, company_description,
                    industry, headquarters, founded_year, company_size,
                    products_services, target_customers, technologies)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (company_id, job_id, company["name"], company["website_url"],
                 company.get("linkedin_url"), "completed",
                 company.get("meta_title"), company.get("meta_description"),
                 company.get("company_description"), company.get("industry"),
                 company.get("headquarters"), company.get("founded_year"),
                 company.get("company_size"), company.get("products_services"),
                 company.get("target_customers"), company.get("technologies"))
            )

            # Add keywords
            keywords = company.get("keywords", {})
            for category, keyword_list in keywords.items():
                for keyword in keyword_list:
                    await db.execute(
                        "INSERT INTO keywords (id, company_id, category, keyword) VALUES (?, ?, ?, ?)",
                        (str(uuid.uuid4()), company_id, category, keyword)
                    )

        await db.commit()

    print(f"Created {len(COMPANIES)} companies with keywords")
    return company_ids


async def seed_contacts(db_path: str, job_id: str, company_ids: dict) -> dict:
    """Create demo contacts and return contact ID mapping."""
    contact_ids = {}

    async with aiosqlite.connect(db_path) as db:
        for contact in CONTACTS_DATA:
            contact_id = str(uuid.uuid4())
            company_id = company_ids.get(contact["company"])
            contact_ids[contact["email"]] = contact_id

            await db.execute(
                """INSERT INTO contacts
                   (id, company_id, job_id, first_name, last_name, email, title, stage, contact_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (contact_id, company_id, job_id, contact["first_name"],
                 contact["last_name"], contact["email"], contact["title"],
                 contact["stage"], "crm")
            )

        # Add personal contacts
        for contact in PERSONAL_CONTACTS:
            contact_id = str(uuid.uuid4())
            contact_ids[contact["email"]] = contact_id

            await db.execute(
                """INSERT INTO contacts
                   (id, first_name, last_name, email, phone, stage, contact_type, relationship, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (contact_id, contact["first_name"], contact["last_name"],
                 contact["email"], contact.get("phone"), "personal", "personal",
                 contact.get("relationship"), contact.get("notes"))
            )

        await db.commit()

    print(f"Created {len(CONTACTS_DATA)} CRM contacts and {len(PERSONAL_CONTACTS)} personal contacts")
    return contact_ids


async def seed_activity(db_path: str, contact_ids: dict):
    """Create demo activity data (notes, outreach, reminders, stage changes)."""
    async with aiosqlite.connect(db_path) as db:
        # Get CRM contacts for activity
        crm_contacts = [c for c in CONTACTS_DATA if c["stage"] not in ["backlog"]]

        for contact in crm_contacts:
            contact_id = contact_ids.get(contact["email"])
            if not contact_id:
                continue

            # Add outreach log entries
            num_outreach = random.randint(1, 3)
            for i in range(num_outreach):
                days_ago = random.randint(1, 30)
                outreach_type = random.choice(["email", "linkedin", "call", "email"])
                note = random.choice(OUTREACH_NOTES)

                await db.execute(
                    """INSERT INTO outreach_log (id, contact_id, outreach_type, note, sent_at)
                       VALUES (?, ?, ?, ?, ?)""",
                    (str(uuid.uuid4()), contact_id, outreach_type, note,
                     (datetime.now() - timedelta(days=days_ago)).isoformat())
                )

            # Add contact notes
            if random.random() > 0.4:
                note_text = random.choice(CONTACT_NOTE_TEMPLATES)

                await db.execute(
                    """INSERT INTO contact_notes (id, contact_id, content, created_at)
                       VALUES (?, ?, ?, ?)""",
                    (str(uuid.uuid4()), contact_id, note_text,
                     (datetime.now() - timedelta(days=random.randint(1, 14))).isoformat())
                )

            # Add reminders for some contacts
            if contact["stage"] in ["engaged", "meeting", "reaching_out"]:
                days_ahead = random.randint(1, 14)
                reminder_notes = [
                    "Follow up on proposal",
                    "Send case study",
                    "Schedule next call",
                    "Check in after demo",
                    "Send contract for review",
                ]

                await db.execute(
                    """INSERT INTO reminders (id, contact_id, due_date, note, completed)
                       VALUES (?, ?, ?, ?, ?)""",
                    (str(uuid.uuid4()), contact_id,
                     (datetime.now() + timedelta(days=days_ahead)).strftime("%Y-%m-%d"),
                     random.choice(reminder_notes), 0)
                )

            # Add stage change history
            stages_progression = {
                "contacted": ["backlog"],
                "reaching_out": ["backlog", "contacted"],
                "engaged": ["backlog", "contacted", "reaching_out"],
                "meeting": ["backlog", "contacted", "reaching_out", "engaged"],
                "won": ["backlog", "contacted", "reaching_out", "engaged", "meeting"],
                "lost": ["backlog", "contacted", "reaching_out"],
            }

            current_stage = contact["stage"]
            if current_stage in stages_progression:
                prev_stages = stages_progression[current_stage]
                for i, stage in enumerate(prev_stages):
                    next_stage = prev_stages[i + 1] if i + 1 < len(prev_stages) else current_stage
                    days_ago = (len(prev_stages) - i) * 3 + random.randint(0, 2)

                    await db.execute(
                        """INSERT INTO stage_changes (id, contact_id, from_stage, to_stage, changed_at)
                           VALUES (?, ?, ?, ?, ?)""",
                        (str(uuid.uuid4()), contact_id, stage, next_stage,
                         (datetime.now() - timedelta(days=days_ago)).isoformat())
                    )

        await db.commit()

    print("Created activity data (outreach, notes, reminders, stage changes)")


async def seed_company_notes(db_path: str, company_ids: dict):
    """Add notes to some companies."""
    async with aiosqlite.connect(db_path) as db:
        companies_with_notes = random.sample(list(company_ids.items()), min(6, len(company_ids)))

        for company_name, company_id in companies_with_notes:
            note_text = random.choice(COMPANY_NOTE_TEMPLATES)

            await db.execute(
                """INSERT INTO company_notes (id, company_id, content, created_at)
                   VALUES (?, ?, ?, ?)""",
                (str(uuid.uuid4()), company_id, note_text,
                 (datetime.now() - timedelta(days=random.randint(1, 14))).isoformat())
            )

        await db.commit()

    print(f"Created notes for {len(companies_with_notes)} companies")


async def seed_email_templates(db_path: str):
    """Create email templates."""
    async with aiosqlite.connect(db_path) as db:
        # First add the default template
        await db.execute(
            "INSERT OR IGNORE INTO email_templates (id, name, category, subject, body) VALUES (?, ?, ?, ?, ?)",
            (DEFAULT_TEMPLATE["id"], DEFAULT_TEMPLATE["name"], DEFAULT_TEMPLATE["category"],
             DEFAULT_TEMPLATE["subject"], DEFAULT_TEMPLATE["body"])
        )

        # Add additional templates
        for template in EMAIL_TEMPLATES:
            await db.execute(
                "INSERT INTO email_templates (id, name, category, subject, body) VALUES (?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), template["name"], template["category"],
                 template["subject"], template["body"])
            )

        await db.commit()

    print(f"Created {len(EMAIL_TEMPLATES) + 1} email templates")


async def seed_database(db_path: str, clear: bool = False):
    """Main function to seed the entire database."""
    print(f"\n{'='*60}")
    print(f"Seeding demo database: {db_path}")
    print(f"{'='*60}\n")

    # Initialize database
    await create_database(db_path, clear)

    # Seed data in order
    job_ids = await seed_jobs(db_path)
    company_ids = await seed_companies(db_path, job_ids["main_job"])
    contact_ids = await seed_contacts(db_path, job_ids["main_job"], company_ids)
    await seed_activity(db_path, contact_ids)
    await seed_company_notes(db_path, company_ids)
    await seed_email_templates(db_path)

    # Print summary
    print(f"\n{'='*60}")
    print("Demo database seeded successfully!")
    print(f"{'='*60}")
    print(f"\nDatabase location: {db_path}")
    print(f"\nSummary:")
    print(f"  - {len(COMPANIES)} companies with enrichment data")
    print(f"  - {len(CONTACTS_DATA)} CRM contacts across all pipeline stages")
    print(f"  - {len(PERSONAL_CONTACTS)} personal contacts")
    print(f"  - {len(EMAIL_TEMPLATES) + 1} email templates")
    print(f"  - Activity data: outreach logs, notes, reminders, stage changes")
    print(f"\nTo use this database, either:")
    print(f"  1. Set DATABASE_PATH={db_path} in .env")
    print(f"  2. Copy to: cp {db_path} data/kanbun.db")
    print()


def main():
    parser = argparse.ArgumentParser(description="Seed Kanbun demo database")
    parser.add_argument(
        "--output", "-o",
        default="data/demo.db",
        help="Output database path (default: data/demo.db)"
    )
    parser.add_argument(
        "--clear", "-c",
        action="store_true",
        help="Clear existing database before seeding"
    )

    args = parser.parse_args()

    # Safety check: never allow overwriting production database
    protected_files = ["data/kanbun.db", "kanbun.db"]
    if args.output in protected_files:
        print("ERROR: Refusing to overwrite production database (data/kanbun.db)")
        print("Use a different output path like: data/demo.db")
        sys.exit(1)

    asyncio.run(seed_database(args.output, args.clear))


if __name__ == "__main__":
    main()
