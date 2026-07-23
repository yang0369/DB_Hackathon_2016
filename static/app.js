let sampleJobs = [];
let selectedJob = null;
let currentMatchResults = [];
let currentJobMode = "form";
let currentRole = "hr";
let currentRankingMode = "pool"; // "pool" = all candidates, "applicants" = applied only
let activeCandidate = null; // Stored candidate profile for active job seeker
let userApplications = [];

document.addEventListener("DOMContentLoaded", () => {
  fetchSampleJobs();
  loadCandidatesList();
  setupDragAndDrop();
  loadSeekerJobs();
});

function openApiKeyModal() {}
function closeApiKeyModal() {}
async function saveApiKey() {}


function switchPortalRole(role) {
  currentRole = role;
  document.getElementById("roleHrBtn").classList.toggle("active", role === 'hr');
  document.getElementById("roleSeekerBtn").classList.toggle("active", role === 'seeker');

  document.getElementById("hrPortalView").classList.toggle("active", role === 'hr');
  document.getElementById("seekerPortalView").classList.toggle("active", role === 'seeker');

  if (role === 'seeker') {
    loadSeekerJobs();
    loadSeekerApplications();
  } else {
    fetchSampleJobs();
    loadCandidatesList();
  }
}

function switchHrTab(tabId, btnElement) {
  document.querySelectorAll("#hrPortalView .tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll("#hrPortalView .nav-btn").forEach(el => el.classList.remove("active"));
  
  document.getElementById(tabId).classList.add("active");
  if (btnElement) btnElement.classList.add("active");

  if (tabId === "hrRepositoryTab") {
    loadCandidatesList();
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
  const title = document.getElementById("customJdTitle").value.trim() || "Target Job Position";
  const dept = document.getElementById("customJdDept") ? document.getElementById("customJdDept").value.trim() : "Engineering";
  const desc = document.getElementById("customJdDesc") ? document.getElementById("customJdDesc").value.trim() : "";
  const targetCount = parseInt(document.getElementById("customJdTargetCount").value) || 3;
  const salMin = parseFloat(document.getElementById("customJdSalMin").value) || 120000;
  const salMax = parseFloat(document.getElementById("customJdSalMax").value) || 160000;
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

    if (statusSpan) statusSpan.innerText = `✅ Extracted ${selectedJob.required_skills.length} key skills — see criteria preview below!`;

    // Wait 2s so HR can read the preview, then navigate to ranking
    setTimeout(() => {
      currentMatchResults = [];
      switchHrTab('hrApplicantsTab', document.querySelectorAll("#hrPortalView .nav-btn")[1]);
      document.getElementById("jobSelect").value = selectedJob.id;
      loadSelectedJobApplicants();
    }, 2500);

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
  const jobId = document.getElementById("jobSelect").value;
  selectedJob = sampleJobs.find(j => j.id === jobId);

  const card = document.getElementById("jobDetailsCard");
  const container = document.getElementById("leaderboardContainer");
  const kpiContainer = document.getElementById("analyticsKpiContainer");
  const visualPanel = document.getElementById("visualAnalyticsPanel");

  if (!selectedJob) {
    card.style.display = "none";
    kpiContainer.style.display = "none";
    visualPanel.style.display = "none";
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 30px;">Select a Job Position above to evaluate applicants.</p>`;
    return;
  }

  card.style.display = "block";
  document.getElementById("jdTitle").innerText = selectedJob.title;
  document.getElementById("jdDesc").innerText = selectedJob.description;
  document.getElementById("jdSkillsList").innerText = (selectedJob.required_skills || []).join(", ");
  document.getElementById("jdTargetCountBadge").innerText = `${selectedJob.target_candidate_count || 3} Candidates`;
  document.getElementById("jdAvailBadge").innerText = selectedJob.required_availability || "Any";
  document.getElementById("jdNatBadge").innerText = selectedJob.required_nationality || "Any";

  const salMin = selectedJob.salary_min ? `$${selectedJob.salary_min.toLocaleString()}` : '';
  const salMax = selectedJob.salary_max ? `$${selectedJob.salary_max.toLocaleString()}` : '';
  document.getElementById("jdSalaryBadge").innerText = (salMin && salMax) ? `💵 Salary: ${salMin} - ${salMax} / yr` : '💵 Competitive Salary';

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
  } catch (err) {
    container.innerHTML = `<p style="color: #fca5a5; text-align: center;">❌ Error evaluating candidates: ${err.message}</p>`;
  }
}

function renderAnalyticsDashboard(matches) {
  const kpiContainer = document.getElementById("analyticsKpiContainer");
  const visualPanel = document.getElementById("visualAnalyticsPanel");
  const chartContainer = document.getElementById("chartContainer");

  if (!matches || matches.length === 0) {
    kpiContainer.style.display = "none";
    visualPanel.style.display = "none";
    return;
  }

  kpiContainer.style.display = "grid";
  visualPanel.style.display = "block";

  const totalApps = matches.length;
  const targetX = selectedJob.target_candidate_count || 3;
  const shortlisted = matches.filter(m => m.selection_status === "Shortlisted for Interview" || m.selection_status === "Selected").length;
  const topMatches = matches.slice(0, targetX);
  const avgTopScore = topMatches.length > 0
    ? Math.round(topMatches.reduce((acc, m) => acc + m.match_score, 0) / topMatches.length)
    : 0;
  const avgSkillIndex = Math.round(matches.reduce((acc, m) => acc + (m.weighted_skill_score || m.skill_coverage || 0), 0) / totalApps);

  document.getElementById("kpiTotalApps").innerText = totalApps;
  document.getElementById("kpiTargetCount").innerText = targetX;
  document.getElementById("kpiShortlisted").innerText = shortlisted;
  document.getElementById("kpiAvgTopScore").innerText = `${avgTopScore}%`;
  document.getElementById("kpiSkillIndex").innerText = `${avgSkillIndex}%`;

  chartContainer.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${topMatches.map((m, i) => {
        const score = Math.round(m.match_score);
        const skillScore = Math.round(m.weighted_skill_score || m.skill_coverage || 0);
        const color = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#f43f5e';
        return `
          <div style="display:flex; align-items:center; gap:12px; padding:10px 14px; background:rgba(8,14,30,0.5); border-radius:10px; border:1px solid var(--border);">
            <span style="font-size:0.72rem; font-weight:800; color:var(--text-500); width:18px; text-align:center;">#${i+1}</span>
            <span style="font-weight:700; color:#fff; font-size:0.87rem; min-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.candidate_name}</span>
            <div style="flex:1; display:flex; align-items:center; gap:8px;">
              <div style="flex:1; height:6px; background:rgba(255,255,255,0.07); border-radius:3px; overflow:hidden;">
                <div style="height:100%; width:${score}%; background:${color}; border-radius:3px; transition:width 0.6s ease;"></div>
              </div>
              <span style="font-size:0.85rem; font-weight:800; color:${color}; min-width:38px; text-align:right;">${score}%</span>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              ${(m.matched_skills || []).slice(0,3).map(s => `<span style="background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.25); color:#6ee7b7; padding:1px 7px; border-radius:10px; font-size:0.72rem;">${s}</span>`).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
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
                  <div style="display:flex; gap:5px; align-items:center;">
                    <button class="btn-primary" onclick="openHRProposalModal('${m.candidate_id}')" style="font-size:0.72rem; padding:5px 10px;">Details</button>
                    ${!isDisqualified ? `<button onclick="shortlistCandidate('${m.candidate_id}')" style="font-size:0.7rem; padding:4px 8px; border-radius:6px; background:rgba(245,158,11,0.1); color:#fde68a; border:1px solid rgba(245,158,11,0.25); cursor:pointer;">⭐</button>` : ''}
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

  const btn = document.getElementById("modalShortlistBtn");
  btn.onclick = () => shortlistCandidate(match.candidate_id);

  document.getElementById("hrModal").classList.add("active");
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
