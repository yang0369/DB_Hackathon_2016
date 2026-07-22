import os
import uuid
import datetime
from backend.models import CandidateProfile, ExperienceItem, EducationItem, CandidateRecord
from backend.vector_store import VectorStore

def seed_sample_candidates(vector_store: VectorStore):
    """Pre-populate sample candidate profiles into the database for immediate testing."""
    sample_candidates = [
        CandidateRecord(
            id="cand-001",
            profile=CandidateProfile(
                full_name="Alex Chen",
                email="alex.chen@example.com",
                phone="+1 (555) 234-5678",
                location="San Francisco, CA",
                summary="Senior Python Developer with 6 years of experience building high-throughput microservices, REST APIs with FastAPI/Django, and asynchronous data processing pipelines.",
                skills=["Python", "FastAPI", "Django", "SQL", "PostgreSQL", "Docker", "REST API", "Redis", "AWS", "Git"],
                experience=[
                    ExperienceItem(
                        title="Senior Backend Engineer",
                        company="CloudData Systems",
                        duration="2021 - Present",
                        description="Designed and deployed FastAPI microservices serving over 10M daily requests. Optimized PostgreSQL queries reducing p99 latency by 40%."
                    ),
                    ExperienceItem(
                        title="Python Developer",
                        company="TechCorp Solutions",
                        duration="2018 - 2021",
                        description="Built scalable Django REST API endpoints and celery background queues."
                    )
                ],
                education=[
                    EducationItem(
                        degree="Bachelor of Science in Computer Science",
                        institution="University of California, Berkeley",
                        year="2018"
                    )
                ],
                certifications=["AWS Certified Solutions Architect"],
                years_of_experience=6.0
            ),
            raw_text="Alex Chen Senior Python Developer FastAPI Django PostgreSQL Docker AWS REST API CloudData Systems",
            file_name="Alex_Chen_Resume.pdf",
            created_at=datetime.datetime.now().isoformat()
        ),
        CandidateRecord(
            id="cand-002",
            profile=CandidateProfile(
                full_name="Samantha Patel",
                email="samantha.patel@example.com",
                phone="+1 (555) 876-5432",
                location="New York, NY",
                summary="Full Stack Developer passionate about crafting responsive React/TypeScript UIs and scalable Node.js/Express backends.",
                skills=["JavaScript", "TypeScript", "React", "Node.js", "Express", "Next.js", "CSS", "Tailwind", "MongoDB", "Git"],
                experience=[
                    ExperienceItem(
                        title="Full Stack Software Engineer",
                        company="PixelCraft Labs",
                        duration="2020 - Present",
                        description="Developed modern React applications using TypeScript and Next.js. Created REST APIs in Node.js/Express."
                    )
                ],
                education=[
                    EducationItem(
                        degree="Bachelor of Science in Software Engineering",
                        institution="Columbia University",
                        year="2020"
                    )
                ],
                certifications=[],
                years_of_experience=4.0
            ),
            raw_text="Samantha Patel Full Stack React Node TypeScript Next.js Express MongoDB PixelCraft",
            file_name="Samantha_Patel_Resume.pdf",
            created_at=datetime.datetime.now().isoformat()
        ),
        CandidateRecord(
            id="cand-003",
            profile=CandidateProfile(
                full_name="Dr. Marcus Vance",
                email="marcus.vance@example.com",
                phone="+1 (555) 998-1122",
                location="Boston, MA",
                summary="AI & ML Research Scientist specializing in PyTorch, Large Language Models (LLMs), RAG pipelines, NLP, and vector search engines.",
                skills=["Python", "Machine Learning", "PyTorch", "TensorFlow", "Pandas", "NumPy", "LLM", "RAG", "ChromaDB", "Scikit-Learn"],
                experience=[
                    ExperienceItem(
                        title="Lead AI Engineer",
                        company="Cognitive Labs",
                        duration="2022 - Present",
                        description="Architected RAG pipeline with vector databases (ChromaDB) and fine-tuned domain-specific LLM models."
                    ),
                    ExperienceItem(
                        title="Data Scientist",
                        company="DataMind Corp",
                        duration="2019 - 2022",
                        description="Built predictive ML models using PyTorch and TensorFlow."
                    )
                ],
                education=[
                    EducationItem(
                        degree="Ph.D. in Artificial Intelligence",
                        institution="MIT",
                        year="2019"
                    )
                ],
                certifications=["Google Cloud Professional Data Engineer"],
                years_of_experience=5.0
            ),
            raw_text="Marcus Vance AI Machine Learning Engineer PyTorch TensorFlow LLM RAG ChromaDB Cognitive Labs",
            file_name="Marcus_Vance_Resume.pdf",
            created_at=datetime.datetime.now().isoformat()
        ),
        CandidateRecord(
            id="cand-004",
            profile=CandidateProfile(
                full_name="Jordan Taylor",
                email="jordan.t@example.com",
                phone="+1 (555) 333-4444",
                location="Austin, TX",
                summary="Junior Software Engineer with foundational Java, HTML/CSS, and Python scripting experience looking for entry level roles.",
                skills=["Java", "HTML", "CSS", "Python", "Git", "SQL"],
                experience=[
                    ExperienceItem(
                        title="Software Engineer Intern",
                        company="Startup Hub",
                        duration="2023 - 2023",
                        description="Assisted with bug fixes and frontend HTML/CSS updates."
                    )
                ],
                education=[
                    EducationItem(
                        degree="Bachelor of Science in Information Technology",
                        institution="University of Texas",
                        year="2023"
                    )
                ],
                certifications=[],
                years_of_experience=1.0
            ),
            raw_text="Jordan Taylor Junior Developer Java HTML CSS Python SQL",
            file_name="Jordan_Taylor_Resume.pdf",
            created_at=datetime.datetime.now().isoformat()
        )
    ]

    for record in sample_candidates:
        vector_store.add_candidate(record)
    
    print(f"Successfully seeded {len(sample_candidates)} sample candidates into VectorStore.")

if __name__ == "__main__":
    vs = VectorStore()
    seed_sample_candidates(vs)
