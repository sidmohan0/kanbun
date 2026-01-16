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
# DEMO DATA
# =============================================================================

COMPANIES = [
    {
        "name": "Stripe",
        "website_url": "https://stripe.com",
        "linkedin_url": "https://linkedin.com/company/stripe",
        "meta_title": "Stripe | Payment Processing Platform",
        "meta_description": "Online payment processing for internet businesses. Stripe is a suite of payment APIs that powers commerce for online businesses.",
        "company_description": "Stripe is a technology company that builds economic infrastructure for the internet. Businesses of every size use their software to accept payments and manage their businesses online.",
        "industry": "Financial Technology",
        "headquarters": "San Francisco, CA",
        "founded_year": "2010",
        "company_size": "5000-10000",
        "products_services": "Payment processing, billing, invoicing, fraud prevention, financial reporting",
        "target_customers": "Online businesses, SaaS companies, e-commerce platforms, marketplaces",
        "technologies": '["API-first", "React", "Ruby", "Go", "AWS"]',
        "keywords": {
            "core_product": ["payment processing", "payment APIs", "billing platform", "subscription management"],
            "category_language": ["fintech", "B2B SaaS", "developer tools", "payment infrastructure"],
            "industry_depth": ["PCI compliance", "card networks", "ACH transfers", "wire transfers"],
            "pain_points": ["payment integration complexity", "international payments", "fraud prevention"],
            "customer_segments": ["startups", "enterprise", "e-commerce", "SaaS companies"]
        }
    },
    {
        "name": "Notion",
        "website_url": "https://notion.so",
        "linkedin_url": "https://linkedin.com/company/notionhq",
        "meta_title": "Notion - Your connected workspace",
        "meta_description": "A new tool that blends your everyday work apps into one. It's the all-in-one workspace for you and your team.",
        "company_description": "Notion is an all-in-one workspace that combines notes, docs, wikis, and project management. Teams use Notion to collaborate and stay organized in one place.",
        "industry": "Productivity Software",
        "headquarters": "San Francisco, CA",
        "founded_year": "2016",
        "company_size": "500-1000",
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
        "name": "Figma",
        "website_url": "https://figma.com",
        "linkedin_url": "https://linkedin.com/company/figma",
        "meta_title": "Figma: The Collaborative Interface Design Tool",
        "meta_description": "Figma is the leading collaborative design tool for building meaningful products. Seamlessly design, prototype, develop, and collect feedback.",
        "company_description": "Figma is a collaborative web-based design tool used for UI/UX design, prototyping, and design systems. It enables real-time collaboration between designers and stakeholders.",
        "industry": "Design Software",
        "headquarters": "San Francisco, CA",
        "founded_year": "2012",
        "company_size": "1000-2000",
        "products_services": "UI design, prototyping, design systems, developer handoff, FigJam whiteboarding",
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
        "name": "Linear",
        "website_url": "https://linear.app",
        "linkedin_url": "https://linkedin.com/company/linear-app",
        "meta_title": "Linear – A better way to build products",
        "meta_description": "Linear is a purpose-built tool for planning and building products. Streamline issues, projects, and product roadmaps.",
        "company_description": "Linear is a modern issue tracking and project management tool built for high-performance teams. It focuses on speed, keyboard shortcuts, and a streamlined workflow.",
        "industry": "Project Management",
        "headquarters": "San Francisco, CA",
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
        "name": "Vercel",
        "website_url": "https://vercel.com",
        "linkedin_url": "https://linkedin.com/company/vercel",
        "meta_title": "Vercel: Build and deploy the best web experiences",
        "meta_description": "Vercel is the platform for frontend developers, providing the speed and reliability innovators need to create at the moment of inspiration.",
        "company_description": "Vercel is a cloud platform for frontend developers that enables teams to build, deploy, and scale web applications. Creators of Next.js framework.",
        "industry": "Cloud Infrastructure",
        "headquarters": "San Francisco, CA",
        "founded_year": "2015",
        "company_size": "500-1000",
        "products_services": "Frontend cloud, edge network, serverless functions, Next.js framework",
        "target_customers": "Frontend developers, web agencies, enterprise teams",
        "technologies": '["Next.js", "React", "Edge Functions", "Rust"]',
        "keywords": {
            "core_product": ["frontend cloud", "deployment platform", "edge network", "Next.js"],
            "category_language": ["DX-focused", "serverless", "JAMstack", "edge computing"],
            "industry_depth": ["ISR", "edge functions", "preview deployments", "analytics"],
            "pain_points": ["deployment complexity", "performance optimization", "scaling"],
            "customer_segments": ["frontend developers", "agencies", "enterprise", "startups"]
        }
    },
    {
        "name": "Supabase",
        "website_url": "https://supabase.com",
        "linkedin_url": "https://linkedin.com/company/supabase",
        "meta_title": "Supabase | The Open Source Firebase Alternative",
        "meta_description": "Build production-grade applications with a Postgres database, Authentication, instant APIs, Realtime, Functions, Storage and Vector embeddings.",
        "company_description": "Supabase is an open-source Firebase alternative providing all the backend services you need to build a product. Built on top of PostgreSQL.",
        "industry": "Backend as a Service",
        "headquarters": "Singapore",
        "founded_year": "2020",
        "company_size": "100-200",
        "products_services": "Database, authentication, storage, realtime subscriptions, edge functions",
        "target_customers": "Full-stack developers, indie hackers, startups, enterprises",
        "technologies": '["PostgreSQL", "Elixir", "TypeScript", "Deno"]',
        "keywords": {
            "core_product": ["backend platform", "PostgreSQL hosting", "authentication", "realtime"],
            "category_language": ["open source", "Firebase alternative", "BaaS", "developer-first"],
            "industry_depth": ["row level security", "edge functions", "vector embeddings", "branching"],
            "pain_points": ["backend complexity", "scaling databases", "auth implementation"],
            "customer_segments": ["indie developers", "startups", "enterprises", "agencies"]
        }
    },
    {
        "name": "Resend",
        "website_url": "https://resend.com",
        "linkedin_url": "https://linkedin.com/company/resend-inc",
        "meta_title": "Resend - Email for developers",
        "meta_description": "The best way to reach humans instead of spam folders. Build, test, and deliver transactional emails at scale.",
        "company_description": "Resend is a modern email API built for developers. It provides a simple way to send transactional emails with high deliverability and great developer experience.",
        "industry": "Email Infrastructure",
        "headquarters": "San Francisco, CA",
        "founded_year": "2022",
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
        "name": "Loom",
        "website_url": "https://loom.com",
        "linkedin_url": "https://linkedin.com/company/loomai",
        "meta_title": "Loom: Async Video Messaging for Work",
        "meta_description": "Record and share video messages of your screen, cam, or both. Faster than typing, more personal than email.",
        "company_description": "Loom is a video messaging platform that helps teams communicate faster with instant video. Record your screen and camera, then share with a link.",
        "industry": "Video Communication",
        "headquarters": "San Francisco, CA",
        "founded_year": "2015",
        "company_size": "200-500",
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
        "name": "Airtable",
        "website_url": "https://airtable.com",
        "linkedin_url": "https://linkedin.com/company/airtable",
        "meta_title": "Airtable | The platform to build next-gen apps",
        "meta_description": "Airtable is a platform to build next-gen apps, faster. Move beyond rigid tools and build apps that power your workflows.",
        "company_description": "Airtable is a low-code platform that combines the simplicity of a spreadsheet with the power of a database. Teams use it to build custom apps and workflows.",
        "industry": "Low-Code Platform",
        "headquarters": "San Francisco, CA",
        "founded_year": "2012",
        "company_size": "500-1000",
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
        "name": "Retool",
        "website_url": "https://retool.com",
        "linkedin_url": "https://linkedin.com/company/retlokai",
        "meta_title": "Retool | The fastest way to build internal tools",
        "meta_description": "Build internal tools remarkably fast. Retool is a new approach to building internal tools where visual programming meets the power of real code.",
        "company_description": "Retool is a low-code platform for building internal tools. It connects to any database or API and lets teams build dashboards, admin panels, and CRUD apps quickly.",
        "industry": "Internal Tools",
        "headquarters": "San Francisco, CA",
        "founded_year": "2017",
        "company_size": "200-500",
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
        "name": "Posthog",
        "website_url": "https://posthog.com",
        "linkedin_url": "https://linkedin.com/company/posthog",
        "meta_title": "PostHog - The open source Product OS",
        "meta_description": "PostHog is the all-in-one platform for building better products - with product analytics, feature flags, A/B testing, session replay, and more.",
        "company_description": "PostHog is an open-source product analytics platform. It provides everything product teams need to understand user behavior - analytics, session replay, feature flags, and A/B testing.",
        "industry": "Product Analytics",
        "headquarters": "London, UK",
        "founded_year": "2020",
        "company_size": "50-100",
        "products_services": "Product analytics, session replay, feature flags, A/B testing, surveys",
        "target_customers": "Product teams, engineers, growth teams, startups",
        "technologies": '["React", "Python", "ClickHouse", "Kafka"]',
        "keywords": {
            "core_product": ["product analytics", "session replay", "feature flags", "A/B testing"],
            "category_language": ["open source", "self-hosted", "all-in-one", "Product OS"],
            "industry_depth": ["funnels", "retention", "cohorts", "autocapture"],
            "pain_points": ["data silos", "tool fragmentation", "privacy compliance"],
            "customer_segments": ["product teams", "engineers", "startups", "enterprise"]
        }
    },
    {
        "name": "Clerk",
        "website_url": "https://clerk.com",
        "linkedin_url": "https://linkedin.com/company/clerkinc",
        "meta_title": "Clerk | Authentication and User Management",
        "meta_description": "Clerk is a complete suite of embeddable UIs, flexible APIs, and admin dashboards to authenticate and manage your users.",
        "company_description": "Clerk provides drop-in authentication and user management for modern applications. It handles sign-up, sign-in, user profiles, and organization management out of the box.",
        "industry": "Authentication",
        "headquarters": "San Francisco, CA",
        "founded_year": "2020",
        "company_size": "50-100",
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
    # Stripe contacts
    {"company": "Stripe", "first_name": "Patrick", "last_name": "Collison", "title": "CEO", "email": "patrick@stripe.com", "stage": "meeting"},
    {"company": "Stripe", "first_name": "Claire", "last_name": "Hughes Johnson", "title": "COO", "email": "claire@stripe.com", "stage": "engaged"},
    {"company": "Stripe", "first_name": "David", "last_name": "Singleton", "title": "CTO", "email": "david.s@stripe.com", "stage": "contacted"},
    # Notion contacts
    {"company": "Notion", "first_name": "Ivan", "last_name": "Zhao", "title": "CEO", "email": "ivan@notion.so", "stage": "engaged"},
    {"company": "Notion", "first_name": "Akshay", "last_name": "Kothari", "title": "COO", "email": "akshay@notion.so", "stage": "reaching_out"},
    # Figma contacts
    {"company": "Figma", "first_name": "Dylan", "last_name": "Field", "title": "CEO", "email": "dylan@figma.com", "stage": "won"},
    {"company": "Figma", "first_name": "Sho", "last_name": "Kuwamoto", "title": "VP Product", "email": "sho@figma.com", "stage": "meeting"},
    # Linear contacts
    {"company": "Linear", "first_name": "Karri", "last_name": "Saarinen", "title": "CEO", "email": "karri@linear.app", "stage": "engaged"},
    {"company": "Linear", "first_name": "Tuomas", "last_name": "Artman", "title": "CTO", "email": "tuomas@linear.app", "stage": "backlog"},
    # Vercel contacts
    {"company": "Vercel", "first_name": "Guillermo", "last_name": "Rauch", "title": "CEO", "email": "guillermo@vercel.com", "stage": "contacted"},
    {"company": "Vercel", "first_name": "Lee", "last_name": "Robinson", "title": "VP DX", "email": "lee@vercel.com", "stage": "reaching_out"},
    # Supabase contacts
    {"company": "Supabase", "first_name": "Paul", "last_name": "Copplestone", "title": "CEO", "email": "paul@supabase.io", "stage": "meeting"},
    {"company": "Supabase", "first_name": "Ant", "last_name": "Wilson", "title": "CTO", "email": "ant@supabase.io", "stage": "backlog"},
    # Resend contacts
    {"company": "Resend", "first_name": "Zeno", "last_name": "Rocha", "title": "CEO", "email": "zeno@resend.com", "stage": "lost"},
    # Loom contacts
    {"company": "Loom", "first_name": "Joe", "last_name": "Thomas", "title": "CEO", "email": "joe@loom.com", "stage": "naf"},
    {"company": "Loom", "first_name": "Vinay", "last_name": "Hiremath", "title": "CTO", "email": "vinay@loom.com", "stage": "backlog"},
    # Airtable contacts
    {"company": "Airtable", "first_name": "Howie", "last_name": "Liu", "title": "CEO", "email": "howie@airtable.com", "stage": "reaching_out"},
    {"company": "Airtable", "first_name": "Andrew", "last_name": "Ofstad", "title": "CPO", "email": "andrew@airtable.com", "stage": "backlog"},
    # Retool contacts
    {"company": "Retool", "first_name": "David", "last_name": "Hsu", "title": "CEO", "email": "david@retool.com", "stage": "engaged"},
    # Posthog contacts
    {"company": "Posthog", "first_name": "James", "last_name": "Hawkins", "title": "CEO", "email": "james@posthog.com", "stage": "contacted"},
    {"company": "Posthog", "first_name": "Tim", "last_name": "Glaser", "title": "CTO", "email": "tim@posthog.com", "stage": "backlog"},
    # Clerk contacts
    {"company": "Clerk", "first_name": "Colin", "last_name": "Sidoti", "title": "CEO", "email": "colin@clerk.com", "stage": "backlog"},
    {"company": "Clerk", "first_name": "Braden", "last_name": "Sidoti", "title": "CTO", "email": "braden@clerk.com", "stage": "backlog"},
]

PERSONAL_CONTACTS = [
    {"first_name": "Sarah", "last_name": "Chen", "email": "sarah.chen@gmail.com", "phone": "+1 (555) 123-4567", "relationship": "friend", "notes": "Met at React Conf 2023. Interested in developer tools."},
    {"first_name": "Michael", "last_name": "Torres", "email": "m.torres@outlook.com", "phone": "+1 (555) 234-5678", "relationship": "acquaintance", "notes": "Connected on LinkedIn. Works at Google Cloud."},
    {"first_name": "Emily", "last_name": "Johnson", "email": "emily.j@icloud.com", "phone": "+1 (555) 345-6789", "relationship": "family", "notes": "Cousin. Software engineer at Netflix."},
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
    "Previously worked at {company}. Good technical background.",
    "Prefers async communication. Very responsive on email.",
    "Budget approved for Q1. Need to move fast.",
    "Introduced by {name}. Warm lead.",
    "Mentioned they're unhappy with current solution.",
    "Technical buyer - will need to see documentation.",
    "Has influence over purchasing but not final decision maker.",
]

COMPANY_NOTE_TEMPLATES = [
    "Series B funded, growing quickly. Good timing for our product.",
    "Competitor to {company}. Could be strategic partnership opportunity.",
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
                note_text = note_text.format(company="Google", name="John Smith")

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
            note_text = note_text.format(company="Notion", name="Alex")

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
