let sampleJobs = [];
let selectedJob = null;
let currentMatchResults = [];
let currentJobMode = "form";
let currentRole = "hr";
let currentRankingMode = "pool"; // "pool" = all candidates, "applicants" = applied only
let activeCandidate = null; // Stored candidate profile for active job seeker
let userApplications = [];

let currentUser = null;

document.addEventListener("DOMContentLoaded", () => {
  setupDragAndDrop();
  checkAuthSessionOnLoad();
});

function openApiKeyModal() {}
function closeApiKeyModal() {}
async function saveApiKey() {}

function checkAuthSessionOnLoad() {
  const saved = sessionStorage.getItem("hiringaid_auth_user");
  if (saved) {
    try {
      const user = JSON.parse(saved);
      if (user && user.email && user.role) {
        performAuthLogin(user.email, user.role);
        return;
      }
    } catch (e) {}
  }

  // If no authenticated session, lock portals & prompt login
  lockAllPortalsAndShowLogin();
}

function lockAllPortalsAndShowLogin() {
  currentUser = null;
  sessionStorage.removeItem("hiringaid_auth_user");

  const hrView = document.getElementById("hrPortalView");
  const seekerView = document.getElementById("seekerPortalView");
  if (hrView) hrView.classList.remove("active");
  if (seekerView) seekerView.classList.remove("active");

  const activeDisplay = document.getElementById("activeUserDisplay");
  if (activeDisplay) {
    activeDisplay.innerText = "🔒 Not Logged In";
    activeDisplay.style.color = "var(--amber)";
  }

  const signInBtn = document.getElementById("headerSignInBtn");
  const logoutBtn = document.getElementById("headerLogoutBtn");
  if (signInBtn) signInBtn.style.display = "inline-block";
  if (logoutBtn) logoutBtn.style.display = "none";

  openAuthModal();
}

function logoutUser() {
  lockAllPortalsAndShowLogin();
}

function openAuthModal() {
  const modal = document.getElementById("authLoginModal");
  if (modal) modal.classList.add("active");
}

function closeAuthModal() {
  // Only allow closing if logged in
  if (!currentUser) return;
  const modal = document.getElementById("authLoginModal");
  if (modal) modal.classList.remove("active");
}

async function performAuthLogin(email, role) {
  await loginUserAccount(email, role);
  
  const modal = document.getElementById("authLoginModal");
  if (modal) modal.classList.remove("active");

  const signInBtn = document.getElementById("headerSignInBtn");
  const logoutBtn = document.getElementById("headerLogoutBtn");
  if (signInBtn) signInBtn.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "inline-block";

  if (role === 'hr') {
    switchHrStageView('post_job');
  } else {
    switchSeekerTab('seekerInboxTab', document.querySelector("#seekerPortalView .nav-btn"));
    loadCandidateInbox();
  }
}

function performCustomLogin() {
  const emailInput = document.getElementById("customLoginEmail");
  const roleSelect = document.getElementById("customLoginRole");
  const email = emailInput ? emailInput.value.trim() : "candidate@gmail.com";
  const role = roleSelect ? roleSelect.value : "candidate";

  if (!email) {
    alert("Please enter a valid email address.");
    return;
  }

  performAuthLogin(email, role);
}

async function loginUserAccount(email, role) {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, role: role })
    });
    if (res.ok) {
      currentUser = await res.json();
    } else {
      currentUser = { email: email, name: role === 'hr' ? 'HR Manager' : 'Candidate', role: role };
    }
  } catch(e) {
    currentUser = { email: email, name: role === 'hr' ? 'HR Manager' : 'Candidate', role: role };
  }

  sessionStorage.setItem("hiringaid_auth_user", JSON.stringify(currentUser));

  const activeDisplay = document.getElementById("activeUserDisplay");
  if (activeDisplay) {
    activeDisplay.innerText = currentUser.email;
    activeDisplay.style.color = "var(--cyan)";
  }
  
  const seekerNav = role === 'candidate' || role === 'seeker' ? 'seeker' : 'hr';
  switchPortalRole(seekerNav);

  if (seekerNav === 'seeker') {
    const inboxEmailEl = document.getElementById("inboxUserEmail");
    if (inboxEmailEl) inboxEmailEl.innerText = currentUser.email;
    loadCandidateInbox();
  }
}

function switchPortalRole(role) {
  currentRole = role;
  const isHr = role === 'hr';
  const hrBtn = document.getElementById("roleHrBtn");
  const seekerBtn = document.getElementById("roleSeekerBtn");
  if (hrBtn) hrBtn.classList.toggle("active", isHr);
  if (seekerBtn) seekerBtn.classList.toggle("active", !isHr);

  const hrView = document.getElementById("hrPortalView");
  const seekerView = document.getElementById("seekerPortalView");
  if (hrView) hrView.classList.toggle("active", isHr);
  if (seekerView) seekerView.classList.toggle("active", !isHr);

  if (!isHr) {
    loadCandidateInbox();
    loadSeekerJobs();
    loadSeekerApplications();
  } else {
    fetchSampleJobs();
    loadCandidatesList();
  }
}

function switchHrStageView(stageKey) {
  const stageViews = {
    'post_job': 'stagePostJobView',
    'screening': 'stageScreeningView',
    'ai_interview': 'stageAiInterviewView',
    'physical_interview': 'stagePhysicalInterviewView',
    'selection': 'stageSelectionView'
  };

  const stageNodes = {
    'post_job': 'stageNodePostJob',
    'screening': 'stageNodeScreening',
    'ai_interview': 'stageNodeAi',
    'physical_interview': 'stageNodePhysical',
    'selection': 'stageNodeSelection'
  };

  Object.keys(stageViews).forEach(key => {
    const viewEl = document.getElementById(stageViews[key]);
    const nodeEl = document.getElementById(stageNodes[key]);
    if (viewEl) viewEl.style.display = (key === stageKey) ? 'block' : 'none';
    if (nodeEl) nodeEl.classList.toggle('active', key === stageKey);
  });

  if (stageKey === 'screening') {
    fetchSampleJobs().then(() => {
      const select = document.getElementById("jobSelect");
      if (select && select.options.length > 1 && !select.value) {
        select.selectedIndex = 1;
        loadSelectedJobApplicants();
      }
    });
  } else if (stageKey === 'ai_interview') {
    loadHRCompletedInterviews();
  }
}

function switchHrTab(tabId, btnElement) {
  document.querySelectorAll("#hrPortalView .tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll("#hrPortalView .nav-btn").forEach(el => el.classList.remove("active"));
  
  document.getElementById(tabId).classList.add("active");
  if (btnElement) btnElement.classList.add("active");

  if (tabId === "hrRepositoryTab") {
    loadCandidatesList();
  } else if (tabId === "hrInterviewsTab") {
    loadHRCompletedInterviews();
  } else if (tabId === "hrApplicantsTab") {
    fetchSampleJobs().then(() => {
      const select = document.getElementById("jobSelect");
      if (select && select.options.length > 1) {
        if (!select.value) {
          select.selectedIndex = 1;
        }
        // Automatically trigger evaluation if no analytics cached for target job
        if (!currentMatchResults || currentMatchResults.length === 0) {
          loadSelectedJobApplicants();
        }
      }
    });
  }
}


function switchSeekerTab(tabId, btnElement) {
  document.querySelectorAll("#seekerPortalView .tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll("#seekerPortalView .nav-btn").forEach(el => el.classList.remove("active"));
  
  document.getElementById(tabId).classList.add("active");
  if (btnElement) btnElement.classList.add("active");

  if (tabId === "seekerJobsTab") {
    loadSeekerJobs();
  } else if (tabId === "seekerAppsTab") {
    loadSeekerApplications();
  }
}

function switchJobMode(mode) {
  currentJobMode = mode;
  document.getElementById("modeFormBtn").classList.toggle("active", mode === 'form');
  document.getElementById("modeAiBtn").classList.toggle("active", mode === 'ai');

  document.getElementById("modeFormContainer").style.display = mode === 'form' ? "block" : "none";
  document.getElementById("modeAiContainer").style.display = mode === 'ai' ? "block" : "none";
}

function generateSkillWeightSliders() {
  const reqStr = document.getElementById("customJdReqSkills").value.trim();
  const container = document.getElementById("skillWeightBuilderList");
  if (!reqStr) {
    container.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted);">Enter required skills above and click "Generate Weights" to customize individual skill importance.</p>`;
    return;
  }

  const skills = reqStr.split(",").map(s => s.trim()).filter(s => s);
  if (skills.length === 0) return;

  const defaultWeight = Math.round(100 / skills.length);

  container.innerHTML = skills.map((skill, idx) => `
    <div class="skill-weight-item">
      <span class="skill-weight-name">🎯 ${skill}</span>
      <input type="range" class="weight-slider" id="weightSlider_${idx}" min="10" max="100" step="5" value="${defaultWeight}" oninput="document.getElementById('weightVal_${idx}').innerText = this.value + '%'">
      <span id="weightVal_${idx}" class="skill-weight-val" style="color:var(--accent-cyan); font-weight:700; font-size:0.85rem;">${defaultWeight}%</span>
    </div>
  `).join("");
}

function getSkillWeightsPayload() {
  const reqStr = document.getElementById("customJdReqSkills").value.trim();
  const skills = reqStr.split(",").map(s => s.trim()).filter(s => s);
  const weights = {};

  skills.forEach((skill, idx) => {
    const slider = document.getElementById(`weightSlider_${idx}`);
    weights[skill] = slider ? parseFloat(slider.value) : (100.0 / skills.length);
  });

  return weights;
}

function setupDragAndDrop() {
  const dropzone = document.getElementById("dropzone");
  if (!dropzone) return;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      uploadFile(files[0]);
    }
  });
}

function handleFileSelect(event) {
  const files = event.target.files;
  if (files.length > 0) {
    uploadFile(files[0]);
  }
}

async function uploadFile(file) {
  const statusDiv = document.getElementById("uploadStatus");
  statusDiv.style.display = "block";
  statusDiv.style.color = "#a5b4fc";
  statusDiv.innerHTML = "⏳ Uploading & parsing resume text with Google AI...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/upload-resume", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Upload failed");
    }

    const candidateRecord = await response.json();
    activeCandidate = candidateRecord;

    statusDiv.style.color = "#6ee7b7";
    statusDiv.innerHTML = `✅ Candidate Profile created for <strong>${candidateRecord.profile.full_name}</strong>! You can now browse & apply for jobs.`;

    renderParsedPreview(candidateRecord.profile);
    loadCandidatesList();
  } catch (error) {
    statusDiv.style.color = "#fca5a5";
    statusDiv.innerHTML = `❌ Error: ${error.message}`;
  }
}

function renderParsedPreview(profile) {
  const container = document.getElementById("parsedProfileContainer");

  const skillsHtml = profile.skills && profile.skills.length > 0
    ? profile.skills.map(s => `<span class="skill-pill">${s}</span>`).join("")
    : `<span style='color:var(--text-500); font-size:0.82rem;'>No skills extracted</span>`;

  const expHtml = profile.experience && profile.experience.length > 0
    ? profile.experience.map(e => `
        <div style="padding:10px 0; border-bottom:1px solid var(--border);">
          <div style="font-weight:700; color:#fff; font-size:0.87rem;">${e.title || 'Role'} <span style="color:var(--cyan); font-weight:500;">@ ${e.company || 'Company'}</span></div>
          <div style="font-size:0.77rem; color:var(--text-500); margin:2px 0;">${e.duration || 'N/A'}</div>
          <p style="font-size:0.82rem; color:var(--text-300); margin-top:3px; line-height:1.5;">${e.description || ''}</p>
        </div>
      `).join("")
    : `<p style='font-size:0.82rem; color:var(--text-500);'>None listed</p>`;

  container.innerHTML = `
    <div style="text-align:left;">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
        <div style="width:44px;height:44px;border-radius:12px;background:var(--grad-primary);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">👤</div>
        <div>
          <h3 style="color:#fff; font-size:1.1rem; font-weight:800; margin-bottom:2px;">${profile.full_name}</h3>
          <div style="font-size:0.78rem; color:var(--text-500);">${profile.email || ''} ${profile.phone ? '· ' + profile.phone : ''}</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
        <span style="background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.2); color:#67e8f9; padding:3px 10px; border-radius:10px; font-size:0.77rem; font-weight:600;">⏳ ${profile.years_of_experience || 0} Yrs</span>
        <span style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.2); color:#6ee7b7; padding:3px 10px; border-radius:10px; font-size:0.77rem; font-weight:600;">⚡ ${profile.availability || 'Immediate'}</span>
        <span style="background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.2); color:#a5b4fc; padding:3px 10px; border-radius:10px; font-size:0.77rem; font-weight:600;">🛂 ${profile.nationality || 'Any'}</span>
      </div>

      ${profile.summary ? `<p style="font-size:0.83rem; color:var(--text-300); margin-bottom:14px; line-height:1.5; padding:10px; background:rgba(8,14,30,0.5); border-radius:8px; border:1px solid var(--border);">${profile.summary}</p>` : ''}

      <div style="margin-bottom:14px;">
        <div style="font-size:0.75rem; font-weight:700; color:var(--text-500); text-transform:uppercase; letter-spacing:.5px; margin-bottom:7px;">Key Skills</div>
        <div class="skills-list">${skillsHtml}</div>
      </div>

      <div>
        <div style="font-size:0.75rem; font-weight:700; color:var(--text-500); text-transform:uppercase; letter-spacing:.5px; margin-bottom:7px;">Work Experience</div>
        ${expHtml}
      </div>
    </div>
  `;
}

async function fetchSampleJobs() {
  try {
    const res = await fetch("/api/sample-jobs");
    sampleJobs = await res.json();

    const select = document.getElementById("jobSelect");
    select.innerHTML = `<option value="">-- Select Target Job Opening --</option>` +
      sampleJobs.map(j => {
        const salStr = (j.salary_min && j.salary_max) ? ` (${j.salary_currency || '$'}${j.salary_min.toLocaleString()} - ${j.salary_currency || '$'}${j.salary_max.toLocaleString()})` : '';
        return `<option value="${j.id}">${j.title}${salStr}</option>`;
      }).join("");
  } catch (err) {
    console.error("Failed to fetch sample jobs:", err);
  }
}

async function triggerBatchProcess() {
  const category = document.getElementById("batchCategorySelect").value;
  const maxCount = parseInt(document.getElementById("batchMaxCount").value) || 15;
  const msgDiv = document.getElementById("batchStatusMessage");

  msgDiv.style.color = "#a5b4fc";
  msgDiv.innerText = `⏳ Batch processing PDF resumes from resumes/data/data/${category} using Google AI model...`;

  try {
    const res = await fetch("/api/batch-process-resumes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: category, max_resumes: maxCount })
    });

    if (!res.ok) throw new Error("Batch processing failed");

    const data = await res.json();
    msgDiv.style.color = "#6ee7b7";
    msgDiv.innerText = `✅ Processed ${data.processed_count} new candidate resumes! Total indexed in database: ${data.total_store_candidates}.`;

    await loadCandidatesList();
    if (selectedJob) {
      loadSelectedJobApplicants();
    }
  } catch (err) {
    msgDiv.style.color = "#fca5a5";
    msgDiv.innerText = `❌ Error batch processing resumes: ${err.message}`;
  }
}

async function extractJdWithAi() {
  const rawText = document.getElementById("rawJdInput").value;
  if (!rawText || !rawText.trim()) {
    alert("Please paste raw job description text first.");
    return;
  }

  const status = document.getElementById("aiJdStatus");
  status.innerHTML = "⏳ Google AI extracting job requirements, skill weights, salary range, and target candidate count...";

  try {
    const res = await fetch("/api/jobs/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: rawText.trim() })
    });

    if (!res.ok) throw new Error("Job parsing failed");

    const parsedJob = await res.json();

    const saveRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedJob)
    });
    selectedJob = await saveRes.json();
    await fetchSampleJobs();

    status.innerHTML = `✅ Published Job Opening: <strong>${selectedJob.title}</strong>!`;

    currentMatchResults = [];
    switchHrTab('hrApplicantsTab', document.querySelectorAll("#hrPortalView .nav-btn")[1]);
    document.getElementById("jobSelect").value = selectedJob.id;
    loadSelectedJobApplicants();


  } catch (err) {
    status.innerHTML = `❌ Error: ${err.message}`;
  }
}

async function submitCustomJobAndMatch() {
  const title = document.getElementById("customJdTitle").value.trim();
  const reqSkillsStr = document.getElementById("customJdReqSkills").value.trim();
  
  if (!title || !reqSkillsStr) {
    alert("Please fill in Job Title and Required Skills.");
    return;
  }

  const dept = document.getElementById("customJdDept").value.trim() || "Engineering";
  const salMin = parseFloat(document.getElementById("customJdSalMin").value) || 100000;
  const salMax = parseFloat(document.getElementById("customJdSalMax").value) || 150000;
  const targetCount = parseInt(document.getElementById("customJdTargetCount").value) || 3;
  const minExp = parseFloat(document.getElementById("customJdMinExp").value) || 0.0;
  const edu = document.getElementById("customJdEdu").value;
  const avail = document.getElementById("customJdAvail").value;
  const nat = document.getElementById("customJdNat").value;
  const prefSkillsStr = document.getElementById("customJdPrefSkills").value.trim();
  const desc = document.getElementById("customJdDesc").value.trim() || `${title} opening in ${dept}.`;

  const reqSkills = reqSkillsStr.split(",").map(s => s.trim()).filter(s => s);
  const prefSkills = prefSkillsStr ? prefSkillsStr.split(",").map(s => s.trim()).filter(s => s) : [];
  const skillWeights = getSkillWeightsPayload();

  const customJobPayload = {
    title: title,
    department: dept,
    required_skills: reqSkills,
    preferred_skills: prefSkills,
    skill_weights: skillWeights,
    min_years_experience: minExp,
    salary_min: salMin,
    salary_max: salMax,
    salary_currency: "$",
    target_candidate_count: targetCount,
    education_level: edu,
    required_availability: avail,
    required_nationality: nat,
    description: desc
  };

  try {
    const saveRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customJobPayload)
    });

    if (!saveRes.ok) throw new Error("Failed to save custom job");

    selectedJob = await saveRes.json();
    await fetchSampleJobs();

    alert(`✅ Successfully published Job Opening: "${selectedJob.title}" with custom skill weights (Targeting Top ${targetCount} Candidates for Interview)`);

    currentMatchResults = [];
    switchHrTab('hrApplicantsTab', document.querySelectorAll("#hrPortalView .nav-btn")[1]);
    document.getElementById("jobSelect").value = selectedJob.id;
    loadSelectedJobApplicants();

  } catch (err) {
    alert(`Error creating job: ${err.message}`);
  }
}

async function autoExtractJobDetailsWithLLM() {
  const titleEl = document.getElementById("customJdTitle");
  const title = (titleEl && titleEl.value.trim()) || "Target Job Position";

  const deptEl = document.getElementById("customJdDept");
  const dept = (deptEl && deptEl.value.trim()) || "Engineering";

  const descEl = document.getElementById("customJdDesc");
  const desc = (descEl && descEl.value.trim()) || "";

  const targetCountEl = document.getElementById("customJdTargetCount");
  const targetCount = targetCountEl ? (parseInt(targetCountEl.value) || 3) : 3;

  const salMinEl = document.getElementById("customJdSalMin");
  const salMin = salMinEl ? (parseFloat(salMinEl.value) || 120000) : 120000;

  const salMaxEl = document.getElementById("customJdSalMax");
  const salMax = salMaxEl ? (parseFloat(salMaxEl.value) || 160000) : 160000;

  const statusSpan = document.getElementById("aiPublishStatus");

  if (!desc.trim()) {
    alert("Please paste or type the full Job Description text first.");
    return;
  }

  const rawText = `Position Title: ${title}\nDepartment: ${dept}\n\n${desc}`;

  if (statusSpan) statusSpan.innerText = "⏳ Google AI extracting key skills, qualifications & experience criteria...";

  try {
    const res = await fetch("/api/jobs/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: rawText })
    });

    if (!res.ok) throw new Error("LLM Job extraction failed");

    const parsedJob = await res.json();
    if (title && title !== "Target Job Position") parsedJob.title = title;
    if (dept) parsedJob.department = dept;
    parsedJob.target_candidate_count = targetCount;
    parsedJob.salary_min = salMin;
    parsedJob.salary_max = salMax;

    // Show extracted criteria preview immediately
    renderExtractedCriteria(parsedJob);

    // Save job into database
    const saveRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedJob)
    });

    selectedJob = await saveRes.json();
    await fetchSampleJobs();

    const skillCount = (selectedJob.required_skills && selectedJob.required_skills.length) || 0;
    if (statusSpan) statusSpan.innerText = `✅ Extracted ${skillCount} key skills — advancing to Stage 2 (Smart Screening)...`;

    setTimeout(() => {
      currentMatchResults = [];
      switchHrStageView('screening');
      const select = document.getElementById("jobSelect");
      if (select) select.value = selectedJob.id;
      loadSelectedJobApplicants();
    }, 600);

  } catch (err) {
    if (statusSpan) statusSpan.innerText = `❌ Error: ${err.message}`;
    alert(`❌ LLM Extraction Error: ${err.message}`);
  }
}

function renderExtractedCriteria(job) {
  const panel = document.getElementById("extractedCriteriaPanel");
  const content = document.getElementById("extractedCriteriaContent");
  if (!panel || !content) return;

  const kr = job.jd_key_requirements || {};
  const skills = kr.key_skills || job.required_skills || [];
  const prefSkills = kr.preferred_skills || job.preferred_skills || [];
  const experience = kr.key_experience || [];
  const qualifications = kr.key_qualifications || [];
  const academic = kr.academic_qualifications || job.academic_qualifications || [];
  const certs = kr.required_certifications || job.required_certifications || [];
  const education = kr.education_level || job.education_level || 'Not specified';
  const minYears = kr.min_years_experience || job.min_years_experience || 0;
  const weights = kr.skill_weights || job.skill_weights || {};
  const hard = kr.hard_criteria || job.hard_criteria || {};
  const mandatoryNat = hard.mandatory_nationality || job.required_nationality || 'Any';

  const pillStyle = (color) => `background:rgba(${color},0.12); border:1px solid rgba(${color},0.28); padding:3px 10px; border-radius:20px; font-size:0.78rem; font-weight:600;`;

  content.innerHTML = `
    <div class="grid-2" style="gap:14px;">
      <!-- Hard Criteria / Knockout Rules -->
      <div style="background:rgba(244,63,94,0.06); border:1px solid rgba(244,63,94,0.25); border-radius:12px; padding:14px; grid-column: 1 / -1;">
        <div style="font-weight:700; color:#fca5a5; font-size:0.85rem; margin-bottom:8px; text-transform:uppercase; letter-spacing:.5px; display:flex; align-items:center; gap:6px;">
          🚫 Hard Non-Negotiable Criteria (Knockout Rules)
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <span style="${pillStyle('244,63,94')} color:#fca5a5;">
            🛂 Mandatory Nationality / Work Status: <strong>${mandatoryNat}</strong>
          </span>
          <span style="${pillStyle('244,63,94')} color:#fde68a;">
            ⏳ Mandatory Min Experience: <strong>${minYears} Years</strong>
          </span>
          <span style="${pillStyle('244,63,94')} color:#a5f3fc;">
            🎓 Required Degree Level: <strong>${education}</strong>
          </span>
          ${certs.length > 0 ? `<span style="${pillStyle('244,63,94')} color:#a5b4fc;">📜 Mandatory Certs: <strong>${certs.join(', ')}</strong></span>` : ''}
        </div>
      </div>

      <!-- Must-Have Skills -->
      <div style="background:rgba(99,102,241,0.06); border:1px solid rgba(99,102,241,0.18); border-radius:12px; padding:14px;">
        <div style="font-weight:700; color:#a5b4fc; font-size:0.82rem; margin-bottom:10px; text-transform:uppercase; letter-spacing:.5px;">🎯 Key Required Skills (${skills.length})</div>
        <div style="display:flex; flex-wrap:wrap; gap:5px;">
          ${skills.map(s => `<span style="${pillStyle('99,102,241')} color:#c7d2fe;">${s}${weights[s] ? ` <span style="opacity:0.6;">${Math.round(weights[s])}%</span>` : ''}</span>`).join('')}
          ${skills.length === 0 ? '<span style="color:var(--text-500); font-size:0.82rem;">None extracted</span>' : ''}
        </div>
      </div>

      <!-- Preferred Skills -->
      <div style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.15); border-radius:12px; padding:14px;">
        <div style="font-weight:700; color:#6ee7b7; font-size:0.82rem; margin-bottom:10px; text-transform:uppercase; letter-spacing:.5px;">⭐ Preferred Skills (${prefSkills.length})</div>
        <div style="display:flex; flex-wrap:wrap; gap:5px;">
          ${prefSkills.map(s => `<span style="${pillStyle('16,185,129')} color:#a7f3d0;">${s}</span>`).join('')}
          ${prefSkills.length === 0 ? '<span style="color:var(--text-500); font-size:0.82rem;">None specified</span>' : ''}
        </div>
      </div>

      <!-- Experience & Role Requirements -->
      <div style="background:rgba(245,158,11,0.05); border:1px solid rgba(245,158,11,0.15); border-radius:12px; padding:14px;">
        <div style="font-weight:700; color:#fbbf24; font-size:0.82rem; margin-bottom:8px; text-transform:uppercase; letter-spacing:.5px;">💼 Key Role Experience</div>
        <ul style="margin:0; padding-left:15px; color:var(--text-300); font-size:0.82rem; line-height:1.7;">
          ${experience.map(e => `<li>${e}</li>`).join('')}
          ${experience.length === 0 ? '<li style="color:var(--text-500);">General professional experience</li>' : ''}
        </ul>
      </div>

      <!-- Academic Qualifications & Education -->
      <div style="background:rgba(6,182,212,0.05); border:1px solid rgba(6,182,212,0.15); border-radius:12px; padding:14px;">
        <div style="font-weight:700; color:#67e8f9; font-size:0.82rem; margin-bottom:8px; text-transform:uppercase; letter-spacing:.5px;">🎓 Academic Qualifications</div>
        <span style="${pillStyle('6,182,212')} color:#a5f3fc; display:inline-block; margin-bottom:8px;">🎓 Degree: ${education}</span>
        <ul style="margin:0; padding-left:15px; color:var(--text-300); font-size:0.82rem; line-height:1.7;">
          ${academic.map(a => `<li>${a}</li>`).join('')}
          ${qualifications.map(q => `<li>${q}</li>`).join('')}
          ${academic.length === 0 && qualifications.length === 0 ? '<li style="color:var(--text-500);">Bachelor in CS / STEM / IT or equivalent preferred</li>' : ''}
        </ul>
      </div>
    </div>

    <div style="margin-top:14px; padding:11px 14px; background:rgba(8,14,30,0.6); border-radius:10px; border:1px solid var(--border); display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
      <span style="font-size:0.82rem; color:var(--text-500);">Auto-ranking in <span id="criteriaCountdown" style="color:var(--cyan); font-weight:700;">2</span>s</span>
      <button onclick="navigateToRankingNow()" class="btn-primary" style="font-size:0.78rem; padding:5px 12px;">⚡ Rank Now</button>
      <span style="font-size:0.8rem; color:var(--text-500);">Job: <strong style="color:#fff;">${job.title}</strong> · <strong style="color:var(--cyan);">${skills.length} skills</strong> · Knockout: <strong style="color:#fca5a5;">${mandatoryNat}</strong></span>
    </div>
  `;

  let count = 2;
  const interval = setInterval(() => {
    count--;
    const el = document.getElementById("criteriaCountdown");
    if (el) el.innerText = count;
    if (count <= 0) clearInterval(interval);
  }, 1000);

  panel.style.display = "block";
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function navigateToRankingNow() {
  if (!selectedJob) return;
  currentMatchResults = [];
  switchHrTab('hrApplicantsTab', document.querySelectorAll("#hrPortalView .nav-btn")[1]);
  document.getElementById("jobSelect").value = selectedJob.id;
  loadSelectedJobApplicants();
}

function setRankingMode(mode) {
  currentRankingMode = mode;
  const poolBtn = document.getElementById("rankModePoolBtn");
  const appsBtn = document.getElementById("rankModeApplicantsBtn");
  const modeLabel = document.getElementById("rankingModeLabel");

  if (poolBtn) poolBtn.className = mode === 'pool' ? 'btn-primary' : 'btn-secondary';
  if (appsBtn) appsBtn.className = mode === 'applicants' ? 'btn-primary' : 'btn-secondary';
  if (modeLabel) modeLabel.innerText = mode === 'pool' ? 'Showing: All Pool Candidates' : 'Showing: Applicants Only';

  // Reload current job with new mode
  if (selectedJob) loadSelectedJobApplicants();
}


async function loadSelectedJobApplicants() {
  const selectEl = document.getElementById("jobSelect");
  const jobId = selectEl ? selectEl.value : "";
  if (jobId) {
    const found = sampleJobs.find(j => j.id === jobId);
    if (found) selectedJob = found;
  }

  const card = document.getElementById("jobDetailsCard");
  const container = document.getElementById("leaderboardContainer");
  const kpiContainer = document.getElementById("analyticsKpiContainer");
  const visualPanel = document.getElementById("visualAnalyticsPanel");

  if (!selectedJob) {
    if (card) card.style.display = "none";
    if (kpiContainer) kpiContainer.style.display = "none";
    if (visualPanel) visualPanel.style.display = "none";
    if (container) container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 30px;">Select a Job Position above to evaluate applicants.</p>`;
    return;
  }

  card.style.display = "block";
  const elTitle = document.getElementById("jdTitle");
  const elDesc = document.getElementById("jdDesc");
  const elSkills = document.getElementById("jdSkillsList");
  const elTarget = document.getElementById("jdTargetCountBadge");

  if (elTitle) elTitle.innerText = selectedJob.title;
  if (elDesc) elDesc.innerText = selectedJob.description;
  if (elSkills) elSkills.innerText = (selectedJob.required_skills || []).join(", ");
  if (elTarget) elTarget.innerText = `${selectedJob.target_candidate_count || 3} Candidates`;

  const modeLabel = currentRankingMode === 'pool' ? 'all pool candidates' : 'applicants only';
  container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">⚡ Ranking ${modeLabel} against job requirements...</p>`;

  try {
    let fetchedResults = [];

    if (currentRankingMode === 'pool') {
      // Rank ALL candidates in the pool
      const res = await fetch(`/api/jobs/${selectedJob.id}/rank-all-candidates`);
      if (res.ok) fetchedResults = await res.json();
    } else {
      // Applicants only
      const res = await fetch(`/api/jobs/${selectedJob.id}/ranked-applicants`);
      if (res.ok) fetchedResults = await res.json();
    }

    // Fallback: if no results from either, use /api/match
    if (!fetchedResults || fetchedResults.length === 0) {
      const fallbackRes = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedJob)
      });
      if (fallbackRes.ok) fetchedResults = await fallbackRes.json();
    }

    currentMatchResults = fetchedResults;
    renderAnalyticsDashboard(currentMatchResults);
    renderLeaderboard(currentMatchResults);
    updatePipelineStageCounts();
  } catch (err) {
    container.innerHTML = `<p style="color: #fca5a5; text-align: center;">❌ Error evaluating candidates: ${err.message}</p>`;
  }
}

function renderAnalyticsDashboard(matches) {
  const kpiContainer = document.getElementById("analyticsKpiContainer");
  const visualPanel = document.getElementById("visualAnalyticsPanel");

  if (!matches || matches.length === 0) {
    if (kpiContainer) kpiContainer.style.display = "none";
    if (visualPanel) visualPanel.style.display = "none";
    return;
  }

  if (kpiContainer) kpiContainer.style.display = "grid";
  if (visualPanel) visualPanel.style.display = "none";

  const totalApps = matches.length;
  const targetX = (selectedJob && selectedJob.target_candidate_count) ? selectedJob.target_candidate_count : 3;
  const shortlisted = matches.filter(m => m.selection_status === "Shortlisted for Interview" || m.selection_status === "Selected").length;
  const topMatches = matches.slice(0, targetX);
  const avgTopScore = topMatches.length > 0
    ? Math.round(topMatches.reduce((acc, m) => acc + m.match_score, 0) / topMatches.length)
    : 0;
  const avgSkillIndex = Math.round(matches.reduce((acc, m) => acc + (m.weighted_skill_score || m.skill_coverage || 0), 0) / totalApps);

  const elTotal = document.getElementById("kpiTotalApps");
  const elTarget = document.getElementById("kpiTargetCount");
  const elShort = document.getElementById("kpiShortlisted");
  const elAvg = document.getElementById("kpiAvgTopScore");
  const elIndex = document.getElementById("kpiSkillIndex");

  if (elTotal) elTotal.innerText = totalApps;
  if (elTarget) elTarget.innerText = targetX;
  if (elShort) elShort.innerText = shortlisted;
  if (elAvg) elAvg.innerText = `${avgTopScore}%`;
  if (elIndex) elIndex.innerText = `${avgSkillIndex}%`;
}


function renderLeaderboard(matches) {
  const container = document.getElementById("leaderboardContainer");
  if (!matches || matches.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-500);">No candidates found for this job. Upload resumes to the Candidate Pool first.</div>`;
    return;
  }

  const targetX = selectedJob ? (selectedJob.target_candidate_count || 3) : 3;

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="rank-table">
        <thead>
          <tr>
            <th style="width:40px;">#</th>
            <th>Candidate</th>
            <th style="text-align:center;">Overall</th>
            <th style="text-align:center;">Skills</th>
            <th style="text-align:center;">Experience</th>
            <th style="text-align:center;">Availability</th>
            <th style="text-align:center;">Recommendation</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${matches.map((m, index) => {
            const isDisqualified = m.hard_criteria_passed === false;
            const isTop = m.is_top_candidate && !isDisqualified;
            const overall = Math.round(m.match_score);
            const skillPct = Math.round(m.weighted_skill_score || m.skill_coverage || 0);
            const expPct = Math.round(m.qualification_score || 0);
            const color = (v, hi=75, mid=50) => isDisqualified ? '#f43f5e' : v >= hi ? '#10b981' : v >= mid ? '#f59e0b' : '#f43f5e';

            let recIcon = '⚠'; let recStyle = 'color:#fca5a5; background:rgba(244,63,94,0.1); border:1px solid rgba(244,63,94,0.2);';
            if (isDisqualified) {
              recIcon = '🚫'; recStyle = 'color:#fca5a5; background:rgba(244,63,94,0.2); border:1px solid rgba(244,63,94,0.4); font-weight:800;';
            } else if (m.hr_recommendation && m.hr_recommendation.toLowerCase().includes('highly')) {
              recIcon = '⭐'; recStyle = 'color:#6ee7b7; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.2);';
            } else if (m.hr_recommendation && m.hr_recommendation.toLowerCase().includes('consider')) {
              recIcon = '👍'; recStyle = 'color:#fde68a; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.2);';
            }

            const recLabel = isDisqualified ? 'Disqualified' : (m.hr_recommendation || 'Review')
              .replace('Highly Recommended', 'Highly Rec.')
              .replace('Consider for Interview', 'Consider')
              .replace('Skip / Low Match', 'Low Match');

            return `
              <tr class="${isTop ? 'top-row' : ''}" style="${isDisqualified ? 'opacity: 0.7;' : ''}">
                <td style="text-align:center; font-weight:800; font-size:0.95rem; color:${isTop ? '#f59e0b' : 'var(--text-500)'};">${
                  isDisqualified ? '🚫' : isTop ? '⭐' : (index+1)
                }</td>
                <td>
                  <div style="font-weight:700; color:#fff; font-size:0.88rem; display:flex; align-items:center; gap:6px;">
                    ${m.candidate_name}
                    ${isTop ? `<span class="top-candidate-badge">TOP ${index+1}</span>` : ''}
                    ${isDisqualified ? `<span style="background:rgba(244,63,94,0.2); color:#fca5a5; font-size:0.7rem; font-weight:800; padding:2px 6px; border-radius:6px;">KNOCKOUT</span>` : ''}
                  </div>
                  <div style="font-size:0.75rem; color:var(--text-500); margin-top:2px;">
                    ${isDisqualified && m.disqualification_reasons && m.disqualification_reasons.length > 0
                      ? `<span style="color:#fca5a5;">🚫 ${m.disqualification_reasons[0]}</span>`
                      : m.matched_skills && m.matched_skills.length > 0
                        ? `✓ ${m.matched_skills.slice(0,3).join(', ')}${m.matched_skills.length > 3 ? ` +${m.matched_skills.length-3}` : ''}`
                        : 'No match'}
                  </div>
                  ${!isDisqualified && m.missing_skills && m.missing_skills.length > 0 ? `<div style="font-size:0.72rem; color:#fca5a5; margin-top:1px;">✗ ${m.missing_skills.slice(0,2).join(', ')}</div>` : ''}
                </td>
                <td style="text-align:center;">
                  <div style="font-size:1.1rem; font-weight:800; color:${color(overall)};">${isDisqualified ? '0%' : overall + '%'}</div>
                  <div class="mini-bar-wrap" style="margin:4px auto 0;"><div class="mini-bar-fill" style="width:${isDisqualified ? 0 : overall}%; background:${color(overall)};"></div></div>
                </td>
                <td style="text-align:center;">
                  <div style="font-size:0.95rem; font-weight:700; color:${color(skillPct,70,40)};">${skillPct}%</div>
                  <div style="font-size:0.68rem; color:var(--text-500);">weighted</div>
                </td>
                <td style="text-align:center;">
                  <div style="font-size:0.95rem; font-weight:700; color:${color(expPct)};">${expPct}%</div>
                  <div style="font-size:0.68rem; color:var(--text-500);">${m.experience_met ? '✓ Met' : '⚠ Gap'}</div>
                </td>
                <td style="text-align:center; font-size:0.8rem; font-weight:600; color:${m.nationality_score === 0 ? '#f43f5e' : m.availability_score >= 90 ? '#10b981' : '#f59e0b'}">
                  ${m.nationality_score === 0 ? '🚫 Mismatch' : (m.availability_score >= 90 ? '✓' : '~') + ' ' + (m.candidate_availability || 'Immediate').replace(' Notice', '')}
                </td>
                <td style="text-align:center;">
                  <span style="${recStyle} padding:3px 8px; border-radius:8px; font-size:0.74rem; font-weight:600; white-space:nowrap;">
                    ${recIcon} ${recLabel}
                  </span>
                </td>
                <td>
                  <div style="display:flex; gap:5px; align-items:center; flex-wrap:nowrap;">
                    <button class="btn-primary" onclick="openHRProposalModal('${m.candidate_id}')" style="font-size:0.72rem; padding:5px 9px;">Details</button>
                    ${!isDisqualified ? `
                      <button onclick="sendInterviewInvitation('${m.candidate_id}', '${selectedJob ? selectedJob.id : ''}')" style="font-size:0.72rem; padding:5px 9px; border-radius:6px; background:linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); color:#fff; border:none; cursor:pointer; font-weight:700; display:flex; align-items:center; gap:3px;">
                        ✉️ Invite
                      </button>
                      <button onclick="startCandidateVoiceInterview('${m.candidate_id}', '${selectedJob ? selectedJob.id : ''}')" style="font-size:0.72rem; padding:5px 9px; border-radius:6px; background:linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color:#fff; border:none; cursor:pointer; font-weight:700; display:flex; align-items:center; gap:3px;">
                        🎙️ Direct
                      </button>
                    ` : ''}
                    ${m.selection_status === 'Interview Completed' ? `
                      <button onclick="checkCandidateInterviewReport('${m.candidate_id}')" style="font-size:0.72rem; padding:5px 9px; border-radius:6px; background:rgba(6,182,212,0.15); color:var(--cyan); border:1px solid rgba(6,182,212,0.3); cursor:pointer; font-weight:700;">
                        📹 Report
                      </button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function shortlistCandidate(candidateId) {
  try {
    const res = await fetch(`/api/applications/${candidateId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Shortlisted for Interview" })
    });

    if (!res.ok) throw new Error("Failed to update status");

    alert(`⭐ Candidate shortlisted for interview!`);
    loadSelectedJobApplicants();
    closeModal();
  } catch (err) {
    alert(`Status update: ${err.message}`);
  }
}

function openHRProposalModal(candidateId) {
  const match = currentMatchResults.find(m => m.candidate_id === candidateId);
  if (!match) return;

  document.getElementById("modalCandidateName").innerText = `HR Proposal & Analytics for ${match.candidate_name}`;
  document.getElementById("modalJobTitle").innerText = `Target Role: ${match.job_title} | Rank #${match.rank_position} | Overall Hybrid Score: ${match.match_score}%`;
  document.getElementById("modalRationale").innerText = match.summary_rationale;

  const banner = document.getElementById("modalRecBanner");
  const recText = document.getElementById("modalRecText");

  banner.className = "rec-banner";
  if (match.hard_criteria_passed === false) {
    banner.classList.add("skip");
    banner.style.background = "rgba(244,63,94,0.2)";
    banner.style.borderColor = "rgba(244,63,94,0.4)";
    banner.style.color = "#fca5a5";
    recText.innerText = `🚫 DISQUALIFIED (HARD CRITERIA KNOCKOUT) - ${match.disqualification_reasons ? match.disqualification_reasons[0] : match.hr_recommendation}`;
  } else if (match.is_top_candidate) {
    banner.classList.add("highly-recommended");
    recText.innerText = `⭐ TOP ${match.rank_position} CANDIDATE FOR INTERVIEW - ${match.hr_recommendation}`;
  } else if (match.match_score >= 50) {
    banner.classList.add("consider");
    recText.innerText = `👍 ${match.hr_recommendation}`;
  } else {
    banner.classList.add("skip");
    recText.innerText = `⚠️ ${match.hr_recommendation}`;
  }

  const qualBadge = document.getElementById("modalQualBadge");
  if (match.experience_met) {
    qualBadge.className = "badge-qual success";
    qualBadge.innerText = `✓ Experience: ${match.experience_summary}`;
  } else {
    qualBadge.className = "badge-qual warning";
    qualBadge.innerText = `⚠️ Experience Gap: ${match.experience_summary}`;
  }

  const skillBadge = document.getElementById("modalSkillScoreBadge");
  skillBadge.className = match.weighted_skill_score >= 60 ? "badge-qual success" : "badge-qual warning";
  skillBadge.innerText = `Weighted Skill Score: ${match.weighted_skill_score || match.skill_coverage}%`;

  const ruleScoreBadge = document.getElementById("modalRuleScoreBadge");
  ruleScoreBadge.className = match.rule_based_score >= 60 ? "badge-qual success" : "badge-qual warning";
  ruleScoreBadge.innerText = `Rule Score: ${match.rule_based_score || 0}%`;

  const llmScoreBadge = document.getElementById("modalLlmScoreBadge");
  llmScoreBadge.className = match.llm_match_score >= 60 ? "badge-qual success" : "badge-qual warning";
  llmScoreBadge.innerText = `LLM Score: ${match.llm_match_score || 0}%`;

  const availBadge = document.getElementById("modalAvailBadge");
  availBadge.innerText = `Availability: ${match.candidate_availability || 'Immediate'}`;

  const natBadge = document.getElementById("modalNatBadge");
  natBadge.innerText = `Status: ${match.candidate_nationality || 'Any'}`;

  // Populate Per-Skill Breakdown Table
  const breakdownBody = document.getElementById("modalSkillBreakdownBody");
  if (match.skill_scores_breakdown && match.skill_scores_breakdown.length > 0) {
    breakdownBody.innerHTML = match.skill_scores_breakdown.map(sb => `
      <tr>
        <td><strong>${sb.skill}</strong></td>
        <td>${sb.weight}%</td>
        <td>${sb.matched ? '<span style="color:#6ee7b7; font-weight:700;">✓ Matched</span>' : '<span style="color:#fca5a5;">✗ Missing</span>'}</td>
        <td><strong style="color:${sb.matched ? '#6ee7b7' : '#fca5a5'};">${sb.score}%</strong></td>
      </tr>
    `).join("");
  } else {
    breakdownBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);">No detailed breakdown available</td></tr>`;
  }

  document.getElementById("modalStrengths").innerHTML = (match.strengths || []).map(s => `<li>${s}</li>`).join("");
  document.getElementById("modalGaps").innerHTML = (match.gaps || []).map(g => `<li>${g}</li>`).join("");

  // Store active match reference & trigger Stage 4 Agent Briefing load
  activeModalMatch = match;
  if (match.hiring_manager_briefing) {
    renderStage4Briefing(match.hiring_manager_briefing);
  } else {
    loadStage4Briefing(match.candidate_id, match.job_id);
  }

  const btn = document.getElementById("modalShortlistBtn");
  btn.onclick = () => shortlistCandidate(match.candidate_id);

  const inviteBtn = document.getElementById("modalInviteInterviewBtn");
  if (inviteBtn) {
    inviteBtn.onclick = () => {
      closeModal();
      sendInterviewInvitation(match.candidate_id, match.job_id);
    };
  }

  const interviewBtn = document.getElementById("modalProceedInterviewBtn");
  if (interviewBtn) {
    interviewBtn.onclick = () => {
      closeModal();
      startCandidateVoiceInterview(match.candidate_id, match.job_id);
    };
  }

  document.getElementById("hrModal").classList.add("active");
}

let activeModalMatch = null;

async function loadStage4Briefing(candidateId, jobId) {
  const container = document.getElementById("modalStage4Container");
  if (!container) return;
  
  container.innerHTML = `<div style="color:var(--cyan); font-size:0.82rem;">⏳ Stage 4 Agent running: Analyzing Stage 1-3 results to formulate Hiring Manager F2F Q&As...</div>`;
  
  try {
    const res = await fetch(`/api/orchestrate/f2f-briefing/${candidateId}/${jobId}`);
    if (!res.ok) throw new Error("Failed to generate Stage 4 briefing");
    const briefing = await res.json();
    renderStage4Briefing(briefing);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--text-muted); font-size:0.82rem;">Stage 4 briefing active based on initial match analysis.</div>`;
  }
}

function renderStage4Briefing(briefing) {
  const container = document.getElementById("modalStage4Container");
  if (!container) return;

  const weakHtml = (briefing.weak_competencies || []).map(wc => `
    <div style="background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.2); border-radius:8px; padding:10px; margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span style="font-weight:700; color:#fbbf24; font-size:0.82rem;">🎯 Focus Area: ${wc.topic}</span>
        <span style="font-size:0.68rem; background:rgba(245,158,11,0.2); color:#fde68a; padding:1px 6px; border-radius:6px; font-weight:700;">${wc.severity}</span>
      </div>
      <p style="color:var(--text-300); font-size:0.78rem; margin:0 0 4px 0; line-height:1.4;">${wc.gap_description}</p>
      <div style="font-size:0.7rem; color:var(--text-500);">Source: ${wc.evidence_source}</div>
    </div>
  `).join("");

  const qHtml = (briefing.proposed_f2f_questions || []).map((q, idx) => `
    <div style="background:rgba(8,14,30,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:12px; margin-bottom:10px;">
      <div style="font-size:0.75rem; font-weight:700; color:var(--cyan); margin-bottom:4px;">
        Question #${idx+1} [Probe Target: ${q.competency}]
      </div>
      <div style="color:#fff; font-weight:700; font-size:0.84rem; margin-bottom:6px; line-height:1.5;">
        "${q.question}"
      </div>
      <div style="font-size:0.76rem; color:var(--text-400); margin-bottom:4px;">
        <strong>Intent:</strong> ${q.intent_and_focus}
      </div>
      <div style="font-size:0.76rem; color:#6ee7b7; background:rgba(16,185,129,0.08); padding:6px; border-radius:6px;">
        <strong>Signal Guide:</strong> ${q.what_to_look_for}
      </div>
    </div>
  `).join("");

  container.innerHTML = `
    <div style="margin-bottom:12px; font-size:0.8rem; color:var(--text-300); line-height:1.5;">
      ${briefing.stage1_summary} ${briefing.stage2_match_summary}
    </div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
      <div>
        <div style="font-size:0.75rem; font-weight:700; color:var(--text-500); text-transform:uppercase; margin-bottom:8px;">
          ⚠️ Weakly Demonstrated Areas (${(briefing.weak_competencies||[]).length})
        </div>
        ${weakHtml || '<div style="color:var(--text-500); font-size:0.8rem;">No weak areas flagged.</div>'}
      </div>
      <div>
        <div style="font-size:0.75rem; font-weight:700; color:var(--text-500); text-transform:uppercase; margin-bottom:8px;">
          ❓ Proposed F2F Interview Questions (${(briefing.proposed_f2f_questions||[]).length})
        </div>
        ${qHtml}
      </div>
    </div>
  `;
}

function generateStage4BriefingUI() {
  if (activeModalMatch) {
    loadStage4Briefing(activeModalMatch.candidate_id, activeModalMatch.job_id);
  }
}

function closeModal() {
  document.getElementById("hrModal").classList.remove("active");
}

async function loadCandidatesList() {
  const container = document.getElementById("candidatesListTable");
  try {
    const res = await fetch("/api/candidates");
    const candidates = await res.json();

    if (!candidates || candidates.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px;">
          <p style="color:var(--text-muted); margin-bottom:12px;">No candidates in database yet.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="font-size:0.78rem; color:var(--text-500); font-weight:600; margin-bottom:14px; text-transform:uppercase; letter-spacing:.5px;">
        ${candidates.length} candidates in pool
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
        ${candidates.map(c => `
          <div style="background:rgba(14,22,44,0.6); padding:14px; border-radius:12px; border:1px solid var(--border); transition:border-color 0.2s;"
               onmouseover="this.style.borderColor='rgba(255,255,255,0.14)'"
               onmouseout="this.style.borderColor='rgba(255,255,255,0.08)'">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
              <div style="width:36px;height:36px;border-radius:10px;background:var(--grad-primary);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">👤</div>
              <div>
                <div style="font-weight:700; color:#fff; font-size:0.9rem;">${c.profile.full_name}</div>
                <div style="font-size:0.72rem; color:var(--text-500); margin-top:1px;">${c.profile.years_of_experience || 0} yrs · ${c.profile.availability || 'Immediate'}</div>
              </div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:10px;">
              ${(c.profile.skills || []).slice(0, 5).map(s => `<span style="background:rgba(99,102,241,0.12); border:1px solid rgba(99,102,241,0.22); color:#a5b4fc; padding:2px 7px; border-radius:8px; font-size:0.72rem;">${s}</span>`).join('')}
              ${(c.profile.skills || []).length > 5 ? `<span style="color:var(--text-500); font-size:0.72rem; padding:2px 4px;">+${(c.profile.skills||[]).length-5}</span>` : ''}
            </div>
            <button class="btn-secondary" style="width:100%; font-size:0.75rem; padding:5px 10px; justify-content:center;" onclick="selectCandidateAsActive('${c.id}')">
              Use as Job Seeker Profile
            </button>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:#fca5a5;">Failed to load candidates: ${err.message}</p>`;
  }
}


async function syncCandidatePool() {
  const container = document.getElementById("candidatesListTable");
  container.innerHTML = `<div style="color:var(--text-500); text-align:center; padding:30px;">⏳ Syncing candidate pool files with vector store...</div>`;
  try {
    const res = await fetch("/api/candidates/sync", { method: "POST" });
    if (!res.ok) throw new Error("Sync failed");
    await loadCandidatesList();
    if (selectedJob) loadSelectedJobApplicants();
  } catch (err) {
    alert(`Sync failed: ${err.message}`);
    loadCandidatesList();
  }
}

async function clearCandidatePool() {
  if (!confirm("Are you sure you want to purge all candidate vector embeddings and candidate records?")) return;
  const container = document.getElementById("candidatesListTable");
  container.innerHTML = `<div style="color:var(--text-500); text-align:center; padding:30px;">⏳ Purging database...</div>`;
  try {
    const res = await fetch("/api/candidates/clear-all", { method: "POST" });
    if (!res.ok) throw new Error("Clear failed");
    await loadCandidatesList();
    currentMatchResults = [];
    if (selectedJob) loadSelectedJobApplicants();
  } catch (err) {
    alert(`Clear failed: ${err.message}`);
    loadCandidatesList();
  }
}

async function selectCandidateAsActive(candidateId) {
  try {
    const res = await fetch(`/api/candidates/${candidateId}`);
    activeCandidate = await res.json();
    alert(`Switched active Job Seeker profile to ${activeCandidate.profile.full_name}`);
    renderParsedPreview(activeCandidate.profile);
    switchPortalRole('seeker');
  } catch (e) {
    alert("Failed to set candidate active profile");
  }
}

/* ==================== JOB SEEKER LOGIC ==================== */

async function loadSeekerJobs() {
  const container = document.getElementById("seekerJobsContainer");
  try {
    const res = await fetch("/api/sample-jobs");
    const jobs = await res.json();

    const appsRes = await fetch("/api/applications");
    userApplications = appsRes.ok ? await appsRes.json() : [];

    if (!jobs || jobs.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted);">No open jobs available at the moment.</p>`;
      return;
    }

    container.innerHTML = jobs.map(j => {
      const salMin = j.salary_min ? `$${j.salary_min.toLocaleString()}` : '';
      const salMax = j.salary_max ? `$${j.salary_max.toLocaleString()}` : '';
      const salaryStr = (salMin && salMax) ? `${salMin} - ${salMax} / yr` : 'Competitive Salary';
      const skillsPills = (j.required_skills || []).map(s => `<span class="skill-pill">${s}</span>`).join("");

      const candId = activeCandidate ? activeCandidate.id : 'cand-001';
      const hasApplied = userApplications.some(a => a.job_id === j.id && a.candidate_id === candId);

      return `
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
              <h3 style="color:#fff; font-size:1.15rem;">${j.title}</h3>
              <span class="salary-badge">💵 ${salaryStr}</span>
            </div>
            <p style="font-size:0.85rem; color:var(--accent-cyan); margin-bottom:10px;">
              🏢 ${j.department || 'General'} | ⏳ Min ${j.min_years_experience || 0} Yrs Exp | 🎓 ${j.education_level || "Bachelor's"}
            </p>
            <div style="font-size:0.82rem; color:var(--text-sub); margin-bottom:10px;">
              ⚡ Desired Availability: <strong>${j.required_availability || 'Any'}</strong> | 🛂 Status: <strong>${j.required_nationality || 'Any'}</strong>
            </div>
            <p style="font-size:0.88rem; color:var(--text-sub); margin-bottom:12px; line-height:1.4;">
              ${(j.description || '').substring(0, 140)}...
            </p>
            <div style="margin-bottom:16px;">
              <strong style="font-size:0.82rem; color:#fff;">Required Skills:</strong>
              <div class="skills-list" style="margin-top:4px;">${skillsPills}</div>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; pt-12; border-top: 1px solid var(--border-color);">
            <span style="font-size:0.8rem; color:var(--text-muted);">Target Top Candidates: <strong>${j.target_candidate_count || 3}</strong></span>
            ${hasApplied
              ? `<button class="btn-secondary" disabled style="color:#6ee7b7; border-color:rgba(16,185,129,0.3);">✓ Applied</button>`
              : `<button class="btn-primary" onclick="applyForJob('${j.id}')">⚡ Apply Now</button>`
            }
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<p style="color:#fca5a5;">Failed to load job postings: ${err.message}</p>`;
  }
}

async function applyForJob(jobId) {
  const candidateId = activeCandidate ? activeCandidate.id : 'cand-001';
  const candidateAvail = activeCandidate ? (activeCandidate.profile.availability || "Immediate") : "Immediate";
  const candidateNat = activeCandidate ? (activeCandidate.profile.nationality || "Any / Citizen") : "Any / Citizen";

  try {
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        candidate_id: candidateId,
        candidate_availability: candidateAvail,
        candidate_nationality: candidateNat
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Application failed");
    }

    const appRecord = await res.json();
    alert(`🎉 Application successfully submitted! Application ID: ${appRecord.id}`);
    loadSeekerJobs();
    loadSeekerApplications();
  } catch (err) {
    alert(`❌ Application Error: ${err.message}`);
  }
}

async function loadSeekerApplications() {
  const container = document.getElementById("seekerAppsContainer");
  const candidateId = activeCandidate ? activeCandidate.id : 'cand-001';

  try {
    const res = await fetch(`/api/applications?candidate_id=${candidateId}`);
    const apps = await res.json();

    if (!apps || apps.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:20px;">You haven't submitted any job applications yet. Go to <strong>Browse & Apply for Jobs</strong> tab!</p>`;
      return;
    }

    const jobsRes = await fetch("/api/sample-jobs");
    const jobs = jobsRes.ok ? await jobsRes.json() : [];

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">
        ${apps.map(a => {
          const job = jobs.find(j => j.id === a.job_id);
          const jobTitle = job ? job.title : a.job_id;
          const salaryStr = job && job.salary_min ? `$${job.salary_min.toLocaleString()} - $${job.salary_max.toLocaleString()}` : 'Competitive';

          let statusClass = "applied";
          if (a.status === "Shortlisted for Interview") statusClass = "shortlisted";
          else if (a.status === "Selected") statusClass = "selected";

          return `
            <div style="background:rgba(15, 23, 42, 0.7); border:1px solid var(--border-color); border-radius:10px; padding:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <h4 style="color:#fff; font-size:1.05rem;">${jobTitle}</h4>
                <span class="status-badge ${statusClass}">${a.status}</span>
              </div>
              <p style="font-size:0.85rem; color:var(--accent-cyan);">Salary Range: ${salaryStr}</p>
              <p style="font-size:0.8rem; color:var(--text-muted); margin-top:6px;">Applied on: ${new Date(a.applied_at).toLocaleDateString()}</p>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:#fca5a5;">Failed to load applications: ${err.message}</p>`;
  }
}


/* ════════════════════════════════════════════════════════════════
   AI VOICE CALL AGENT INTERVIEW & CAMERA RECORDING MODULE
════════════════════════════════════════════════════════════════ */
let currentInterviewSession = null;
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let speechRecognition = null;
let isVoiceRecording = false;

let tabSwitchCount = 0;
let suspiciousSilenceCount = 0;
let interviewTimerInterval = null;
let interviewSeconds = 0;

// Setup Anti-Cheating Window Blur Listener
window.addEventListener("blur", () => {
  if (currentInterviewSession && currentInterviewSession.status === "In Progress") {
    tabSwitchCount++;
    const statusEl = document.getElementById("tabFocusStatus");
    const flagsEl = document.getElementById("liveCheatingFlags");
    if (statusEl) {
      statusEl.innerText = "Blurred (Tab Switch Detected)";
      statusEl.style.color = "#f43f5e";
    }
    if (flagsEl) {
      flagsEl.innerText = `${tabSwitchCount} Anomaly Flags`;
      flagsEl.style.color = "#f43f5e";
    }
  }
});

window.addEventListener("focus", () => {
  if (currentInterviewSession && currentInterviewSession.status === "In Progress") {
    const statusEl = document.getElementById("tabFocusStatus");
    if (statusEl) {
      statusEl.innerText = "Focused ✓";
      statusEl.style.color = "#6ee7b7";
    }
  }
});


async function startCandidateVoiceInterview(candidateId, jobId) {
  if (!jobId && selectedJob) jobId = selectedJob.id;
  if (!jobId) {
    alert("Please select a job position first to start the candidate interview.");
    return;
  }

  try {
    const res = await fetch("/api/interview/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_id: candidateId, job_id: jobId })
    });

    if (!res.ok) throw new Error("Failed to initialize interview session");
    
    currentInterviewSession = await res.json();
    tabSwitchCount = 0;
    suspiciousSilenceCount = 0;
    interviewSeconds = 0;
    recordedChunks = [];

    // UI Updates
    document.getElementById("intCandidateTitle").innerText = `AI Voice Interview — ${currentInterviewSession.candidate_name}`;
    document.getElementById("intJobSubtitle").innerText = `Target Role: ${currentInterviewSession.job_title} | Session ID: ${currentInterviewSession.session_id}`;
    
    document.getElementById("tabFocusStatus").innerText = "Focused ✓";
    document.getElementById("tabFocusStatus").style.color = "#6ee7b7";
    document.getElementById("liveCheatingFlags").innerText = "0 Anomaly Flags";
    document.getElementById("liveCheatingFlags").style.color = "var(--cyan)";

    updateStageStepUI(0);
    renderInterviewTranscript();

    document.getElementById("interviewRoomModal").classList.add("active");

    // Start Timer
    if (interviewTimerInterval) clearInterval(interviewTimerInterval);
    interviewTimerInterval = setInterval(() => {
      interviewSeconds++;
      const mins = String(Math.floor(interviewSeconds / 60)).padStart(2, '0');
      const secs = String(interviewSeconds % 60).padStart(2, '0');
      const timerEl = document.getElementById("interviewTimer");
      if (timerEl) timerEl.innerText = `${mins}:${secs}`;
    }, 1000);

    // Request Camera Stream & start recording
    await requestCameraAccess();

    // Speak initial welcome & first question
    if (currentInterviewSession.questions && currentInterviewSession.questions.length > 0) {
      speakAgentText(currentInterviewSession.questions[0].question_text);
    }
  } catch (err) {
    alert(`Interview Initialization Error: ${err.message}`);
  }
}

async function requestCameraAccess() {
  const videoEl = document.getElementById("interviewCameraFeed");
  const overlay = document.getElementById("cameraPromptOverlay");

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (videoEl) {
      videoEl.srcObject = mediaStream;
    }
    if (overlay) overlay.style.display = "none";

    // Setup MediaRecorder for candidate video recording
    if (window.MediaRecorder) {
      recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : (MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "");

      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
      mediaRecorder.start(1000);
    }
  } catch (err) {
    console.warn("Camera access request warning:", err);
    if (overlay) {
      overlay.style.display = "flex";
      overlay.querySelector("div:nth-child(2)").innerText = "Camera / Mic Permission Needed";
    }
  }
}

function updateStageStepUI(index) {
  const steps = [document.getElementById("stageStep1"), document.getElementById("stageStep2"), document.getElementById("stageStep3")];
  steps.forEach((s, idx) => {
    if (s) {
      if (idx === index) s.className = "stage-step active";
      else s.className = "stage-step";
    }
  });
}

function renderInterviewTranscript() {
  const box = document.getElementById("interviewTranscriptBox");
  if (!box || !currentInterviewSession) return;

  if (!currentInterviewSession.turns || currentInterviewSession.turns.length === 0) {
    box.innerHTML = `<div style="color:var(--text-500); text-align:center; padding-top:40px;">Starting voice interview...</div>`;
    return;
  }

  box.innerHTML = currentInterviewSession.turns.map(t => {
    const isAgent = t.speaker === "agent";
    return `
      <div style="display:flex; flex-direction:column; align-items:${isAgent ? 'flex-start' : 'flex-end'};">
        <div style="font-size:0.7rem; color:var(--text-500); margin-bottom:2px; display:flex; gap:6px;">
          <span>${isAgent ? '🤖 AI Interview Agent' : '👤 Candidate'}</span>
          <span>[${t.timestamp}]</span>
        </div>
        <div style="max-width:85%; padding:9px 13px; border-radius:10px; line-height:1.5; font-size:0.83rem; ${
          isAgent 
            ? 'background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3); color:#e0e7ff;' 
            : 'background:rgba(6,182,212,0.15); border:1px solid rgba(6,182,212,0.3); color:#cff4fc;'
        }">
          ${t.text}
        </div>
      </div>
    `;
  }).join("");

  box.scrollTop = box.scrollHeight;
}

function speakAgentText(text) {
  const wave = document.getElementById("voiceWaveform");
  const statusText = document.getElementById("agentStatusText");
  if (statusText) statusText.innerText = "Speaking question...";
  if (wave) wave.classList.add("speaking");

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => {
      if (wave) wave.classList.remove("speaking");
      if (statusText) statusText.innerText = "Listening for candidate response...";
    };
    utterance.onerror = () => {
      if (wave) wave.classList.remove("speaking");
      if (statusText) statusText.innerText = "Ready for candidate response";
    };
    window.speechSynthesis.speak(utterance);
  } else {
    setTimeout(() => {
      if (wave) wave.classList.remove("speaking");
      if (statusText) statusText.innerText = "Ready for candidate response";
    }, 2500);
  }
}

function toggleVoiceRecording() {
  const btn = document.getElementById("micToggleBtn");
  const input = document.getElementById("manualSpeechInput");

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!isVoiceRecording) {
    if (SpeechRecognition) {
      try {
        speechRecognition = new SpeechRecognition();
        speechRecognition.continuous = false;
        speechRecognition.interimResults = true;
        speechRecognition.lang = 'en-US';

        speechRecognition.onstart = () => {
          isVoiceRecording = true;
          if (btn) {
            btn.classList.add("recording");
            btn.innerHTML = `🔴 Listening...`;
          }
        };

        speechRecognition.onresult = (event) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          if (input) input.value = transcript;
        };

        speechRecognition.onerror = (e) => {
          console.warn("Speech recognition error:", e);
          stopSpeechRecognition();
        };

        speechRecognition.onend = () => {
          stopSpeechRecognition();
        };

        speechRecognition.start();
      } catch (err) {
        console.warn("SpeechRecognition start error:", err);
        fallbackManualMicPrompt();
      }
    } else {
      fallbackManualMicPrompt();
    }
  } else {
    stopSpeechRecognition();
  }
}

function stopSpeechRecognition() {
  isVoiceRecording = false;
  const btn = document.getElementById("micToggleBtn");
  if (btn) {
    btn.classList.remove("recording");
    btn.innerHTML = `🎙️ Speak`;
  }
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch(e){}
    speechRecognition = null;
  }
}

function fallbackManualMicPrompt() {
  const input = document.getElementById("manualSpeechInput");
  if (input) {
    input.focus();
    input.placeholder = "Type candidate answer and press Send...";
  }
}

async function sendCandidateVoiceTurn() {
  const input = document.getElementById("manualSpeechInput");
  const speechText = input ? input.value.trim() : "";
  if (!speechText) {
    alert("Please speak or type a response before sending.");
    return;
  }

  stopSpeechRecognition();
  if (input) input.value = "";

  const candidateTurns = currentInterviewSession.turns.filter(t => t.speaker === "candidate");
  const currentQIdx = candidateTurns.length;
  const currentQuestion = currentInterviewSession.questions[currentQIdx] || currentInterviewSession.questions[currentInterviewSession.questions.length - 1];

  try {
    const res = await fetch("/api/interview/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: currentInterviewSession.session_id,
        candidate_speech_text: speechText,
        stage: currentQuestion ? currentQuestion.stage : "interview",
        current_question_index: currentQIdx,
        tab_switch_count: tabSwitchCount,
        suspicious_silence_count: suspiciousSilenceCount
      })
    });

    if (!res.ok) throw new Error("Failed to process interview turn");
    const turnResult = await res.json();

    // Update local session turns
    currentInterviewSession.turns.push({
      speaker: "candidate",
      text: speechText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      stage: currentQuestion ? currentQuestion.stage : "interview"
    });

    if (turnResult.agent_speech) {
      currentInterviewSession.turns.push({
        speaker: "agent",
        text: turnResult.agent_speech,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        stage: turnResult.is_complete ? "complete" : (currentInterviewSession.questions[turnResult.question_index] ? currentInterviewSession.questions[turnResult.question_index].stage : "interview")
      });

      renderInterviewTranscript();
      updateStageStepUI(Math.min(2, turnResult.question_index || 0));
      speakAgentText(turnResult.agent_speech);
    }

    if (turnResult.is_complete) {
      setTimeout(() => {
        finishAndEvaluateInterview();
      }, 3000);
    }

  } catch (err) {
    alert(`Turn Error: ${err.message}`);
  }
}

async function finishAndEvaluateInterview() {
  if (!currentInterviewSession) return;
  stopSpeechRecognition();
  if (interviewTimerInterval) clearInterval(interviewTimerInterval);

  try {
    // 1. Stop video recorder and wait for onstop event
    await new Promise(resolve => {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.onstop = resolve;
        mediaRecorder.stop();
      } else {
        resolve();
      }
    });

    await new Promise(r => setTimeout(r, 400));

    if (recordedChunks.length > 0) {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const formData = new FormData();
      formData.append("session_id", currentInterviewSession.session_id);
      formData.append("file", blob, `${currentInterviewSession.session_id}.webm`);

      try {
        await fetch("/api/interview/upload-video", {
          method: "POST",
          body: formData
        });
      } catch (uploadErr) {
        console.warn("Video upload notice:", uploadErr);
      }
    }

    // Stop media stream tracks
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }

    // 2. Evaluate interview voice & cheating metrics
    const evalRes = await fetch("/api/interview/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: currentInterviewSession.session_id,
        tab_switches: tabSwitchCount,
        suspicious_silences: suspiciousSilenceCount,
        gaze_anomalies: 0
      })
    });

    if (!evalRes.ok) throw new Error("Failed to generate evaluation report");
    const completedSession = await evalRes.json();

    document.getElementById("interviewRoomModal").classList.remove("active");
    
    // Refresh HR stage pipeline, candidate inbox, and leaderboard
    updatePipelineStageCounts();
    loadHRCompletedInterviewsStage();
    loadHRCompletedInterviews();
    loadCandidateInbox();
    loadSelectedJobApplicants();

    // Open HR Report Modal
    displayInterviewReport(completedSession);

  } catch (err) {
    alert(`Evaluation Error: ${err.message}`);
  }
}

function cancelVoiceInterview() {
  if (confirm("Finish and submit your recorded voice interview & video data to HR for evaluation?")) {
    finishAndEvaluateInterview();
  } else {
    stopSpeechRecognition();
    if (interviewTimerInterval) clearInterval(interviewTimerInterval);
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    document.getElementById("interviewRoomModal").classList.remove("active");
  }
}

async function checkCandidateInterviewReport(candidateId) {
  try {
    const res = await fetch(`/api/interview/candidate/${candidateId}`);
    if (!res.ok) throw new Error("Failed to fetch interview history");
    const sessions = await res.json();
    if (!sessions || sessions.length === 0) {
      alert("No interview session found for this candidate.");
      return;
    }

    const latest = sessions[sessions.length - 1];
    displayInterviewReport(latest);
  } catch (err) {
    alert(`Report Fetch Error: ${err.message}`);
  }
}

function displayInterviewReport(session) {
  document.getElementById("reportCandidateName").innerText = `Voice Interview Report — ${session.candidate_name}`;
  document.getElementById("reportJobTitle").innerText = `Target Position: ${session.job_title} | Date: ${new Date(session.created_at).toLocaleDateString()}`;

  const videoPlayer = document.getElementById("hrReportVideoPlayer");
  const noStreamMsg = document.getElementById("videoNoStreamMsg");

  if (session.video_filename) {
    videoPlayer.src = `/interview_videos/${session.video_filename}`;
    videoPlayer.style.display = "block";
    if (noStreamMsg) noStreamMsg.style.display = "none";
  } else if (recordedChunks.length > 0) {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    videoPlayer.src = URL.createObjectURL(blob);
    videoPlayer.style.display = "block";
    if (noStreamMsg) noStreamMsg.style.display = "none";
  } else {
    videoPlayer.style.display = "none";
    if (noStreamMsg) noStreamMsg.style.display = "block";
  }

  // Cheating Report UI
  const cheating = session.cheating_report || { cheating_risk_score: 5, risk_level: "Low Risk", summary: "No suspicious behavior.", flags: [] };
  document.getElementById("reportRiskScoreVal").innerText = `${cheating.cheating_risk_score}%`;
  document.getElementById("reportTabSwitchVal").innerText = cheating.tab_switches || 0;
  document.getElementById("reportCheatingSummary").innerText = cheating.summary;

  const riskBadge = document.getElementById("reportRiskBadge");
  riskBadge.innerText = `🛡️ ${cheating.risk_level}`;
  if (cheating.risk_level === "High Risk") {
    riskBadge.style.background = "rgba(244,63,94,0.2)";
    riskBadge.style.color = "#fca5a5";
    riskBadge.style.borderColor = "rgba(244,63,94,0.4)";
  } else if (cheating.risk_level === "Medium Risk") {
    riskBadge.style.background = "rgba(245,158,11,0.2)";
    riskBadge.style.color = "#fde68a";
    riskBadge.style.borderColor = "rgba(245,158,11,0.4)";
  } else {
    riskBadge.style.background = "rgba(16,185,129,0.2)";
    riskBadge.style.color = "#6ee7b7";
    riskBadge.style.borderColor = "rgba(16,185,129,0.4)";
  }

  const flagsList = document.getElementById("reportCheatingFlagsList");
  if (cheating.flags && cheating.flags.length > 0) {
    flagsList.innerHTML = cheating.flags.map(f => `<li>${f}</li>`).join("");
  } else {
    flagsList.innerHTML = `<li style="color:#6ee7b7;">✓ No suspicious flags raised during candidate recording.</li>`;
  }

  // Voice Assessment UI
  const voice = session.voice_assessment || { communication_score: 85, technical_capability_score: 80, confidence_rating: "High Confidence", rationale: "Clear answers provided." };
  document.getElementById("reportCommScore").innerText = `${voice.communication_score}%`;
  document.getElementById("reportTechScore").innerText = `${voice.technical_capability_score}%`;
  document.getElementById("reportConfidence").innerText = voice.confidence_rating;
  document.getElementById("reportVoiceRationale").innerText = voice.rationale;

  document.getElementById("interviewReportModal").classList.add("active");
}

function closeInterviewReportModal() {
  const videoPlayer = document.getElementById("hrReportVideoPlayer");
  if (videoPlayer) {
    videoPlayer.pause();
    videoPlayer.src = "";
  }
  document.getElementById("interviewReportModal").classList.remove("active");
}


/* ════════════════════════════════════════════════════════════════
   INTERVIEW INVITATION & CANDIDATE INBOX FUNCTIONS
════════════════════════════════════════════════════════════════ */
async function sendInterviewInvitation(candidateId, jobId) {
  if (!jobId && selectedJob) jobId = selectedJob.id;
  if (!jobId) {
    alert("Please select a job position first.");
    return;
  }

  try {
    const res = await fetch("/api/interview/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: candidateId,
        job_id: jobId,
        candidate_email: "candidate@gmail.com"
      })
    });

    if (!res.ok) throw new Error("Failed to send interview invitation");
    const inv = await res.json();

    alert(`✉️ Voice Interview invitation dispatched to candidate inbox (${inv.candidate_email})! Status updated to 'Interview Invited'.`);
    loadSelectedJobApplicants();
  } catch (err) {
    alert(`Invitation Error: ${err.message}`);
  }
}

async function loadCandidateInbox() {
  const container = document.getElementById("candidateInboxContainer");
  if (!container) return;

  const email = currentUser ? currentUser.email : "candidate@gmail.com";
  const inboxEmailEl = document.getElementById("inboxUserEmail");
  if (inboxEmailEl) inboxEmailEl.innerText = email;

  try {
    const res = await fetch(`/api/candidate/inbox?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error("Failed to fetch inbox");
    const invitations = await res.json();

    if (!invitations || invitations.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-500);">
          <div style="font-size:2rem; margin-bottom:10px;">📥</div>
          <div style="font-weight:700; color:#fff; font-size:1rem; margin-bottom:4px;">Your Inbox is Empty</div>
          <div style="font-size:0.83rem;">No interview invitations have been sent yet. When HR shortlists your profile and sends an invitation, it will appear here.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">
        ${invitations.map(inv => {
          const isCompleted = inv.status === "Completed";
          return `
            <div style="background:rgba(15,23,42,0.8); border:1px solid var(--border); border-radius:12px; padding:18px; display:flex; flex-direction:column; gap:12px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <h4 style="color:#fff; font-size:1rem; font-weight:800; margin:0;">${inv.job_title}</h4>
                  <div style="color:var(--text-500); font-size:0.78rem; margin-top:3px;">Invited Candidate: ${inv.candidate_name}</div>
                </div>
                <span class="status-badge ${isCompleted ? 'selected' : 'shortlisted'}">
                  ${isCompleted ? '✓ Completed' : '✉️ Action Required'}
                </span>
              </div>

              <div style="font-size:0.82rem; color:var(--text-300); background:rgba(8,14,30,0.6); padding:10px; border-radius:8px; border:1px solid var(--border); line-height:1.5;">
                HR has invited you to conduct an AI Voice Agent interview for the <strong>${inv.job_title}</strong> role. Camera recording &amp; anti-cheating verification will be enabled during the call.
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:var(--text-500);">
                <span>Received: ${new Date(inv.created_at).toLocaleDateString()}</span>
                ${isCompleted ? `
                  <button class="btn-secondary" style="font-size:0.78rem; padding:6px 12px;" onclick="checkCandidateInterviewReport('${inv.candidate_id}')">
                    📹 View Report
                  </button>
                ` : `
                  <button class="btn-primary" style="background:linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); font-size:0.8rem; padding:7px 16px; font-weight:700;" onclick="startCandidateVoiceInterview('${inv.candidate_id}', '${inv.job_id}')">
                    🎙️ Start AI Voice Interview
                  </button>
                `}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:#fca5a5; padding:20px; text-align:center;">Failed to load inbox: ${err.message}</div>`;
  }
}


async function loadHRCompletedInterviews() {
  const container = document.getElementById("hrCompletedInterviewsContainer");
  const badgeEl = document.getElementById("hrVideoBadgeCount");
  if (!container) return;

  try {
    const res = await fetch("/api/hr/completed-interviews");
    if (!res.ok) throw new Error("Failed to fetch completed interviews");
    const sessions = await res.json();

    if (badgeEl) {
      if (sessions && sessions.length > 0) {
        badgeEl.innerText = sessions.length;
        badgeEl.style.display = "inline-block";
      } else {
        badgeEl.style.display = "none";
      }
    }

    if (!sessions || sessions.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-500);">
          <div style="font-size:2rem; margin-bottom:10px;">📹</div>
          <div style="font-weight:700; color:#fff; font-size:1rem; margin-bottom:4px;">No Completed Interview Videos Yet</div>
          <div style="font-size:0.83rem;">When candidates finish their AI Voice Call Interviews, their recorded videos and AI evaluation reports will automatically appear here.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap:20px;">
        ${sessions.map(s => {
          const cheating = s.cheating_report || { cheating_risk_score: 5, risk_level: "Low Risk", summary: "No suspicious behavior" };
          const voice = s.voice_assessment || { communication_score: 85, technical_capability_score: 80, confidence_rating: "High Confidence" };

          let riskColor = "#6ee7b7";
          if (cheating.risk_level === "High Risk") riskColor = "#f43f5e";
          else if (cheating.risk_level === "Medium Risk") riskColor = "#fde68a";

          const videoSrc = s.video_filename ? `/interview_videos/${s.video_filename}` : '';

          return `
            <div style="background:rgba(15,23,42,0.85); border:1px solid var(--border); border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:14px;">
              
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <h4 style="color:#fff; font-size:1.05rem; font-weight:800; margin:0;">${s.candidate_name}</h4>
                  <div style="color:var(--cyan); font-size:0.8rem; margin-top:2px;">Role: ${s.job_title}</div>
                </div>
                <span class="status-badge" style="background:rgba(16,185,129,0.15); color:${riskColor}; border:1px solid ${riskColor}40;">
                  🛡️ ${cheating.risk_level} (${cheating.cheating_risk_score}%)
                </span>
              </div>

              <!-- Embedded Video Player -->
              <div style="position:relative; width:100%; aspect-ratio:16/9; background:#000; border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
                ${videoSrc ? `
                  <video controls style="width:100%; height:100%; object-fit:cover;" src="${videoSrc}"></video>
                ` : `
                  <div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-500); font-size:0.8rem;">
                    📹 Candidate Video Stream Captured
                  </div>
                `}
              </div>

              <!-- Score Summary Strip -->
              <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; background:rgba(8,14,30,0.6); padding:10px; border-radius:10px; border:1px solid var(--border); text-align:center;">
                <div>
                  <div style="font-size:0.68rem; color:var(--text-500);">Communication</div>
                  <div style="font-size:1rem; font-weight:800; color:#6ee7b7;">${voice.communication_score}%</div>
                </div>
                <div>
                  <div style="font-size:0.68rem; color:var(--text-500);">Technical Depth</div>
                  <div style="font-size:1rem; font-weight:800; color:var(--cyan);">${voice.technical_capability_score}%</div>
                </div>
                <div>
                  <div style="font-size:0.68rem; color:var(--text-500);">Confidence</div>
                  <div style="font-size:0.78rem; font-weight:800; color:#fde68a; margin-top:3px;">${voice.confidence_rating.replace(' Confidence','')}</div>
                </div>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:var(--text-500);">
                <span>Date: ${new Date(s.created_at).toLocaleDateString()}</span>
                <button class="btn-primary" style="font-size:0.78rem; padding:6px 14px; font-weight:700;" onclick="displayInterviewReport(${JSON.stringify(s).replace(/"/g, '&quot;')})">
                  🔍 View Full HR Assessment
                </button>
              </div>

            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:#fca5a5; padding:20px; text-align:center;">Failed to load completed interviews: ${err.message}</div>`;
  }
}


/* ════════════════════════════════════════════════════════════════
   HIRING PIPELINE STAGE GRAPH ROUTER & STAGE VIEWS
════════════════════════════════════════════════════════════════ */
let currentHrStage = "post_job";

function switchHrStageView(stageKey) {
  currentHrStage = stageKey;

  // 1. Update node active states in 5-stage pipeline graph bar
  const nodes = {
    post_job: document.getElementById("stageNodePostJob"),
    screening: document.getElementById("stageNodeScreening"),
    ai_interview: document.getElementById("stageNodeAi"),
    physical_interview: document.getElementById("stageNodePhysical"),
    selection: document.getElementById("stageNodeSelection")
  };

  Object.keys(nodes).forEach(key => {
    if (nodes[key]) {
      if (key === stageKey) nodes[key].classList.add("active");
      else nodes[key].classList.remove("active");
    }
  });

  // 2. Update stage content view visibility
  const views = {
    post_job: document.getElementById("stagePostJobView"),
    screening: document.getElementById("stageScreeningView"),
    ai_interview: document.getElementById("stageAiInterviewView"),
    physical_interview: document.getElementById("stagePhysicalInterviewView"),
    selection: document.getElementById("stageSelectionView")
  };

  Object.keys(views).forEach(key => {
    if (views[key]) {
      if (key === stageKey) views[key].style.display = "block";
      else views[key].style.display = "none";
    }
  });

  // 3. Load stage specific data
  if (stageKey === "ai_interview") {
    loadHRCompletedInterviewsStage();
  } else if (stageKey === "physical_interview") {
    loadPhysicalInterviewsView();
  } else if (stageKey === "selection") {
    loadSelectionView();
  } else if (stageKey === "screening" && selectedJob) {
    loadSelectedJobApplicants();
  }
}

function toggleCandidatePoolView() {
  const container = document.getElementById("hrRepositoryContainer");
  const btn = document.getElementById("toggleCandidatePoolBtn");
  if (!container) return;

  if (container.style.display === "none" || !container.style.display) {
    container.style.display = "block";
    if (btn) btn.innerHTML = "✖️ Hide Candidate Pool";
    loadCandidates();
  } else {
    container.style.display = "none";
    if (btn) btn.innerHTML = `📁 View Candidate Pool Vector DB (${candidatePoolList.length || 0} Candidates)`;
  }
}


async function updatePipelineStageCounts() {
  if (!selectedJob) return;

  const jobTitleEl = document.getElementById("pipelineJobTitleDisplay");
  if (jobTitleEl) jobTitleEl.innerText = `Job Position: ${selectedJob.title}`;

  try {
    const res = await fetch(`/api/jobs/${selectedJob.id}/pipeline-summary`);
    if (!res.ok) return;
    const summary = await res.json();
    const counts = summary.counts || {};

    const b1 = document.getElementById("stageBadgeScreening");
    const b2 = document.getElementById("stageBadgeAi");
    const b3 = document.getElementById("stageBadgePhysical");
    const b4 = document.getElementById("stageBadgeSelection");

    if (b1) b1.innerText = `${counts.screening || 0} Candidates`;
    if (b2) b2.innerText = `${counts.ai_interview || 0} Invited / Completed`;
    if (b3) b3.innerText = `${counts.physical_interview || 0} Scheduled`;
    if (b4) b4.innerText = `${counts.selection || 0} Selected`;

  } catch (err) {
    console.warn("Pipeline counts fetch notice:", err);
  }
}

async function loadHRCompletedInterviewsStage() {
  const container = document.getElementById("stageAiCompletedContainer");
  if (!container) return;

  try {
    const res = await fetch("/api/hr/completed-interviews");
    if (!res.ok) throw new Error("Failed to fetch interviews");
    const sessions = await res.json();

    if (!sessions || sessions.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-500);">
          <div style="font-size:2rem; margin-bottom:10px;">🤖</div>
          <div style="font-weight:700; color:#fff; font-size:1rem; margin-bottom:4px;">No Candidate AI Voice Interviews Completed Yet</div>
          <div style="font-size:0.83rem;">When candidates complete their AI Voice Interview, their recorded videos, cheating score, and voice evaluation metrics will render here.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap:20px;">
        ${sessions.map(s => {
          const cheating = s.cheating_report || { cheating_risk_score: 5, risk_level: "Low Risk", summary: "No suspicious behavior" };
          const voice = s.voice_assessment || { communication_score: 85, technical_capability_score: 80, confidence_rating: "High Confidence" };
          let riskColor = "#6ee7b7";
          if (cheating.risk_level === "High Risk") riskColor = "#f43f5e";
          else if (cheating.risk_level === "Medium Risk") riskColor = "#fde68a";
          const videoSrc = s.video_filename ? `/interview_videos/${s.video_filename}` : '';

          return `
            <div style="background:rgba(15,23,42,0.85); border:1px solid var(--border); border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:14px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <h4 style="color:#fff; font-size:1.05rem; font-weight:800; margin:0;">${s.candidate_name}</h4>
                  <div style="color:var(--cyan); font-size:0.8rem; margin-top:2px;">Role: ${s.job_title}</div>
                </div>
                <span class="status-badge" style="background:rgba(16,185,129,0.15); color:${riskColor}; border:1px solid ${riskColor}40;">
                  🛡️ ${cheating.risk_level} (${cheating.cheating_risk_score}%)
                </span>
              </div>

              <div style="position:relative; width:100%; aspect-ratio:16/9; background:#000; border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
                ${videoSrc ? `<video controls style="width:100%; height:100%; object-fit:cover;" src="${videoSrc}"></video>` : `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-500); font-size:0.8rem;">📹 Video Recorded</div>`}
              </div>

              <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; background:rgba(8,14,30,0.6); padding:10px; border-radius:10px; border:1px solid var(--border); text-align:center;">
                <div>
                  <div style="font-size:0.68rem; color:var(--text-500);">Communication</div>
                  <div style="font-size:1rem; font-weight:800; color:#6ee7b7;">${voice.communication_score}%</div>
                </div>
                <div>
                  <div style="font-size:0.68rem; color:var(--text-500);">Technical Depth</div>
                  <div style="font-size:1rem; font-weight:800; color:var(--cyan);">${voice.technical_capability_score}%</div>
                </div>
                <div>
                  <div style="font-size:0.68rem; color:var(--text-500);">Confidence</div>
                  <div style="font-size:0.78rem; font-weight:800; color:#fde68a; margin-top:3px;">${voice.confidence_rating.replace(' Confidence','')}</div>
                </div>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <button class="btn-primary" style="background:linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); font-size:0.76rem; padding:6px 12px;" onclick="schedulePhysicalInterviewPrompt('${s.candidate_id}', '${s.job_id}')">
                  🏢 Schedule On-Site Round ➔
                </button>
                <button class="btn-secondary" style="font-size:0.76rem; padding:6px 12px;" onclick="displayInterviewReport(${JSON.stringify(s).replace(/"/g, '&quot;')})">
                  🔍 Report
                </button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:#fca5a5; padding:20px; text-align:center;">Failed to load interview submissions: ${err.message}</div>`;
  }
}

async function loadPhysicalInterviewsView() {
  const container = document.getElementById("stagePhysicalContainer");
  if (!container) return;

  try {
    const res = await fetch("/api/physical-interview/list");
    if (!res.ok) throw new Error("Failed to fetch physical interviews");
    const schedules = await res.json();

    if (!schedules || schedules.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-500);">
          <div style="font-size:2rem; margin-bottom:10px;">🏢</div>
          <div style="font-weight:700; color:#fff; font-size:1rem; margin-bottom:4px;">No Physical Interviews Scheduled Yet</div>
          <div style="font-size:0.83rem;">Select candidates from Stage 1 (Screening) or Stage 2 (AI Voice Interview) and click <strong>'🏢 Schedule On-Site Round'</strong> to advance them here.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap:18px;">
        ${schedules.map(sch => `
          <div style="background:rgba(15,23,42,0.85); border:1px solid var(--border); border-radius:12px; padding:18px; display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <h4 style="color:#fff; font-size:1.05rem; font-weight:800; margin:0;">${sch.candidate_name}</h4>
                <div style="color:var(--cyan); font-size:0.8rem; margin-top:2px;">Role: ${sch.job_title}</div>
              </div>
              <span class="status-badge shortlisted">🏢 ${sch.status}</span>
            </div>

            <div style="background:rgba(8,14,30,0.6); padding:12px; border-radius:8px; border:1px solid var(--border); font-size:0.82rem; line-height:1.5;">
              <div>📍 <strong>Location:</strong> ${sch.location}</div>
              <div style="margin-top:4px;">⏰ <strong>Scheduled Time:</strong> ${sch.scheduled_time}</div>
              <div style="margin-top:4px; color:var(--text-300);">📝 <strong>Interviewer Notes:</strong> ${sch.interviewer_notes}</div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <button class="btn-primary" style="background:var(--grad-emerald); font-size:0.78rem; padding:7px 14px; font-weight:700;" onclick="advanceCandidateToSelection('${sch.candidate_id}', '${sch.job_id}')">
                ✅ Hire &amp; Make Offer
              </button>
              <button class="btn-secondary" style="font-size:0.75rem; padding:6px 10px;" onclick="checkCandidateInterviewReport('${sch.candidate_id}')">
                📹 Review AI Video
              </button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:#fca5a5; padding:20px; text-align:center;">Failed to load physical interviews: ${err.message}</div>`;
  }
}

async function loadSelectionView() {
  const container = document.getElementById("stageSelectionContainer");
  if (!container) return;

  try {
    const res = await fetch("/api/candidates");
    if (!res.ok) throw new Error("Failed to fetch candidates");
    const candidates = await res.json();

    const selectedList = candidates.filter(c => c.profile.full_name);

    if (!selectedList || selectedList.length === 0) {
      container.innerHTML = `<div style="color:var(--text-500); text-align:center; padding:30px;">No hired candidates yet.</div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">
        ${selectedList.slice(0, 3).map(c => `
          <div style="background:rgba(15,23,42,0.85); border:1px solid rgba(16,185,129,0.3); border-radius:12px; padding:18px; display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h4 style="color:#fff; font-size:1.05rem; font-weight:800; margin:0;">${c.profile.full_name}</h4>
              <span class="status-badge selected">🎉 Offer Extended</span>
            </div>
            <div style="font-size:0.82rem; color:var(--text-300);">Skills: ${(c.profile.skills || []).slice(0,4).join(', ')}</div>
            <div style="font-size:0.78rem; color:#6ee7b7; font-weight:700;">Status: Ready for Onboarding</div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:#fca5a5; padding:20px; text-align:center;">Failed to load selection: ${err.message}</div>`;
  }
}

async function schedulePhysicalInterviewPrompt(candidateId, jobId) {
  if (!jobId && selectedJob) jobId = selectedJob.id;
  const time = prompt("Enter scheduled date and time for the physical on-site interview (e.g. Next Monday 10:00 AM):", "Tomorrow at 2:00 PM");
  if (!time) return;

  try {
    const res = await fetch("/api/physical-interview/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: candidateId,
        job_id: jobId,
        scheduled_time: time,
        location: "Headquarters - Meeting Room 4A",
        notes: "On-site system design & behavioral round with lead engineer."
      })
    });

    if (!res.ok) throw new Error("Failed to schedule physical interview");
    alert("🏢 Physical interview successfully scheduled! Advanced candidate to Stage 3.");
    
    updatePipelineStageCounts();
    switchHrStageView('physical_interview');
  } catch (err) {
    alert(`Scheduling error: ${err.message}`);
  }
}

async function advanceCandidateToSelection(candidateId, jobId) {
  if (!jobId && selectedJob) jobId = selectedJob.id;
  try {
    const res = await fetch("/api/applications/update-stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: candidateId,
        job_id: jobId,
        stage: "Selected"
      })
    });

    if (!res.ok) throw new Error("Failed to update candidate stage");
    alert("🎉 Candidate successfully selected! Formal offer generated and advanced to Stage 4.");
    
    updatePipelineStageCounts();
    switchHrStageView('selection');
  } catch (err) {
    alert(`Stage Update Error: ${err.message}`);
  }
}




