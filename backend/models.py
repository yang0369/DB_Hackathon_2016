from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class EducationItem(BaseModel):
    degree: Optional[str] = Field(default=None, description="Degree or diploma name, e.g. Bachelor of Science in Computer Science")
    institution: Optional[str] = Field(default=None, description="University or school name")
    year: Optional[str] = Field(default=None, description="Graduation year or date range")

class ExperienceItem(BaseModel):
    title: Optional[str] = Field(default=None, description="Job title, e.g. Senior Software Engineer")
    company: Optional[str] = Field(default=None, description="Company name")
    duration: Optional[str] = Field(default=None, description="Dates or duration of employment")
    description: Optional[str] = Field(default=None, description="Summary of responsibilities and achievements")

class SkillWeight(BaseModel):
    skill_name: str = Field(description="Name of the skill")
    weight: float = Field(default=1.0, description="Relative weight or percentage (e.g. 1-10 or 10-100)")

class CandidateProfile(BaseModel):
    full_name: str = Field(description="Candidate's full name")
    email: Optional[str] = Field(default=None, description="Email address")
    phone: Optional[str] = Field(default=None, description="Phone number")
    location: Optional[str] = Field(default=None, description="City, state, or country")
    summary: Optional[str] = Field(default=None, description="Professional summary or headline")
    skills: List[str] = Field(default_factory=list, description="List of technical and soft skills")
    experience: List[ExperienceItem] = Field(default_factory=list, description="Work experience history")
    education: List[EducationItem] = Field(default_factory=list, description="Educational background")
    certifications: List[str] = Field(default_factory=list, description="Certifications or licenses")
    years_of_experience: Optional[float] = Field(default=0.0, description="Estimated total years of professional experience")
    availability: Optional[str] = Field(default="Immediate", description="Availability e.g. Immediate, 2 Weeks Notice, 1 Month Notice")
    nationality: Optional[str] = Field(default="Any / Citizen", description="Nationality or work authorization status")

class HardCriteria(BaseModel):
    """Hard non-negotiable criteria (knockout filters) extracted from job description."""
    mandatory_nationality: Optional[str] = Field(default="Any", description="Strict required nationality or work authorization, e.g. Singapore Citizen/PR, US Citizen")
    strict_degree_required: bool = Field(default=False, description="Whether academic degree is mandatory non-negotiable")
    strict_min_years: Optional[float] = Field(default=None, description="Strict non-negotiable minimum experience years threshold")
    hard_skills: List[str] = Field(default_factory=list, description="Must-have skills that are non-negotiable knockout criteria")

class JDKeyRequirements(BaseModel):
    """Structured LLM-extracted requirements from a raw job description."""
    key_skills: List[str] = Field(default_factory=list, description="Must-have technical/functional skills extracted by LLM")
    preferred_skills: List[str] = Field(default_factory=list, description="Nice-to-have skills extracted by LLM")
    key_experience: List[str] = Field(default_factory=list, description="Key experience bullet points extracted by LLM")
    key_qualifications: List[str] = Field(default_factory=list, description="Key qualifications/certifications extracted by LLM")
    academic_qualifications: List[str] = Field(default_factory=list, description="Academic requirements (e.g. Bachelor in CS/IT/STEM, Master's)")
    required_certifications: List[str] = Field(default_factory=list, description="Required or preferred professional certifications")
    education_level: Optional[str] = Field(default=None, description="Required education level (e.g. Bachelor's, Master's)")
    min_years_experience: Optional[float] = Field(default=None, description="Minimum years of experience required")
    skill_weights: Dict[str, float] = Field(default_factory=dict, description="Per-skill importance weights (0–100)")
    hard_criteria: Optional[HardCriteria] = Field(default=None, description="Strict knockout criteria (e.g. mandatory nationality, degree)")

class JobDescription(BaseModel):
    id: Optional[str] = None
    title: str = Field(description="Job title, e.g. Senior Python Developer")
    department: Optional[str] = Field(default="Engineering")
    required_skills: List[str] = Field(default_factory=list, description="Must-have skills")
    preferred_skills: List[str] = Field(default_factory=list, description="Nice-to-have skills")
    skill_weights: Dict[str, float] = Field(default_factory=dict, description="Skill weights e.g. {'Python': 40, 'FastAPI': 30}")
    min_years_experience: Optional[float] = Field(default=0.0, description="Minimum required years of experience")
    salary_min: Optional[float] = Field(default=None, description="Minimum annual/monthly salary offer")
    salary_max: Optional[float] = Field(default=None, description="Maximum annual/monthly salary offer")
    salary_currency: Optional[str] = Field(default="$", description="Currency symbol e.g. $, €")
    target_candidate_count: int = Field(default=3, description="Target top X candidates for further interview")
    education_level: Optional[str] = Field(default="Bachelor's Degree", description="Minimum education requirement")
    academic_qualifications: List[str] = Field(default_factory=list, description="Academic degree & field requirements")
    required_certifications: List[str] = Field(default_factory=list, description="Required certifications")
    required_availability: Optional[str] = Field(default="Any", description="Desired candidate availability: Immediate, 2 Weeks, 1 Month, Any")
    required_nationality: Optional[str] = Field(default="Any", description="Desired nationality/work authorization: Citizen/PR, Employment Pass, Any")
    hard_criteria: Optional[HardCriteria] = Field(default=None, description="Non-negotiable knockout criteria")
    description: str = Field(description="Full text job description")
    raw_text: Optional[str] = Field(default=None, description="Original raw job description text")
    jd_key_requirements: Optional[JDKeyRequirements] = Field(default=None, description="Structured LLM-extracted criteria preview")

class JobApplication(BaseModel):
    id: str
    job_id: str
    candidate_id: str
    candidate_name: Optional[str] = None
    applied_at: str
    status: str = Field(default="Applied", description="Status: Applied, Shortlisted for Interview, Selected, Rejected")
    candidate_availability: Optional[str] = Field(default="Immediate")
    candidate_nationality: Optional[str] = Field(default="Any")

class MatchAnalysis(BaseModel):
    candidate_id: str
    candidate_name: str
    job_id: str
    job_title: str
    match_score: float = Field(description="Overall match percentage (0 to 100), hybrid of rule-based and LLM evaluation")
    rule_based_score: float = Field(default=0.0, description="Rule-based keyword and heuristic score (0 to 100)")
    llm_match_score: float = Field(default=0.0, description="LLM-evaluated holistic match score (0 to 100)")
    semantic_similarity: float = Field(description="Vector similarity score (0 to 100)")
    skill_coverage: float = Field(description="Percentage of required skills matched")
    skill_match_score: float = Field(default=0.0, description="Unweighted skill match score (0 to 100)")
    weighted_skill_score: float = Field(default=0.0, description="Weighted skill match score (0 to 100) using HR weights")
    skill_scores_breakdown: List[Dict[str, Any]] = Field(default_factory=list, description="Per-skill detail: skill, weight, matched, score")
    qualification_score: float = Field(default=0.0, description="Overall qualification alignment score (0 to 100)")
    academic_score: float = Field(default=100.0, description="Academic background alignment score (0 to 100)")
    availability_score: float = Field(default=100.0, description="Availability match score (0 to 100)")
    availability_matched: bool = Field(default=True, description="Whether availability meets requirement")
    candidate_availability: str = Field(default="Immediate")
    nationality_score: float = Field(default=100.0, description="Nationality/Location match score (0 to 100)")
    nationality_matched: bool = Field(default=True, description="Whether nationality meets requirement")
    candidate_nationality: str = Field(default="Any")
    hard_criteria_passed: bool = Field(default=True, description="Whether candidate satisfies all mandatory non-negotiable hard criteria")
    disqualification_reasons: List[str] = Field(default_factory=list, description="Reasons if disqualified by hard criteria")
    matched_skills: List[str] = Field(default_factory=list)
    missing_skills: List[str] = Field(default_factory=list)
    preferred_matched_skills: List[str] = Field(default_factory=list)
    experience_met: bool = Field(default=True, description="Whether candidate meets minimum experience requirements")
    experience_summary: str = Field(default="", description="Summary of candidate experience relative to requirements")
    strengths: List[str] = Field(default_factory=list, description="Key candidate strengths for this role")
    gaps: List[str] = Field(default_factory=list, description="Areas where candidate falls short")
    hr_recommendation: str = Field(description="AI recommendation rationale for HR (Highly Recommended, Consider, Skip, Disqualified)")
    summary_rationale: str = Field(description="Brief summary proposal for HR")
    is_top_candidate: bool = Field(default=False, description="Whether candidate is within top X target count for HR interview shortlist")
    rank_position: int = Field(default=1, description="Rank index among applicants")
    selection_status: str = Field(default="Applied", description="Current hiring status: Applied, Shortlisted for Interview, Selected, Rejected")

class CandidateRecord(BaseModel):
    id: str
    profile: CandidateProfile
    raw_text: str
    file_name: str
    created_at: str


class InterviewQuestion(BaseModel):
    id: str
    stage: str = Field(description="Stage: experience, capability, qa")
    question_text: str
    expected_aspects: List[str] = Field(default_factory=list)

class InterviewTurn(BaseModel):
    speaker: str = Field(description="agent or candidate")
    text: str
    timestamp: str
    stage: Optional[str] = "interview"

class VoiceAssessment(BaseModel):
    communication_score: float = Field(default=85.0, description="Score 0-100 for clarity, fluency, and expression")
    technical_capability_score: float = Field(default=80.0, description="Score 0-100 for skill & domain expertise shown in answers")
    confidence_rating: str = Field(default="High Confidence", description="High, Moderate, Low")
    rationale: str = Field(default="Candidate articulated technical experience clearly with relevant project examples.")
    strengths: List[str] = Field(default_factory=list)
    areas_for_improvement: List[str] = Field(default_factory=list)

class CheatingReport(BaseModel):
    cheating_risk_score: float = Field(default=10.0, description="Cheating risk score 0-100 (0=no risk, 100=high risk)")
    risk_level: str = Field(default="Low Risk", description="Low Risk, Medium Risk, High Risk")
    tab_switches: int = Field(default=0)
    suspicious_silences: int = Field(default=0)
    gaze_anomalies: int = Field(default=0)
    flags: List[str] = Field(default_factory=list)
    summary: str = Field(default="No suspicious behavior or cheating indicators detected during video call.")

class InterviewSession(BaseModel):
    session_id: str
    candidate_id: str
    candidate_name: str
    job_id: str
    job_title: str
    status: str = Field(default="In Progress", description="In Progress, Completed")
    created_at: str
    questions: List[InterviewQuestion] = Field(default_factory=list)
    turns: List[InterviewTurn] = Field(default_factory=list)
    voice_assessment: Optional[VoiceAssessment] = None
    cheating_report: Optional[CheatingReport] = None
    video_filename: Optional[str] = None


class UserAccount(BaseModel):
    email: str
    name: str
    role: str = Field(description="hr or candidate")
    candidate_id: Optional[str] = None

class InterviewInvitation(BaseModel):
    invitation_id: str
    candidate_email: str
    candidate_id: str
    candidate_name: str
    job_id: str
    job_title: str
    status: str = Field(default="Pending", description="Pending, Completed")
    created_at: str

class PhysicalInterviewSchedule(BaseModel):
    schedule_id: str
    candidate_id: str
    candidate_name: str
    job_id: str
    job_title: str
    location: str = Field(default="Headquarters - Meeting Room 4A")
    scheduled_time: str
    interviewer_notes: Optional[str] = "Technical On-Site Interview & System Architecture Round"
    status: str = Field(default="Scheduled", description="Scheduled, Completed")
    created_at: str






