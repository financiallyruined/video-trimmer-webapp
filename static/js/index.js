const trimForm = document.getElementById("trim-form");
const errorMessage = document.getElementById("error-message");
const progressContainer = document.getElementById("progress-container");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressText = document.getElementById("progress-text");
const downloadLink = document.getElementById("download-link");
const downloadButton = document.getElementById("download-button");
const directoryBrowser = document.getElementById("directory-browser");
const selectedFile = document.getElementById("selected-file");
const selectedFileDisplay = document.getElementById("selected-file-display");
const customPath = document.getElementById("custom-path");
const addSegmentButton = document.getElementById("add-segment");
const timeSegmentsContainer = document.getElementById("time-segments");

let segmentCount = 1; // Start at 1 since we already have one segment

let currentPath = "";

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function truncateFileName(fileName, maxLength = 40) {
  if (fileName.length <= maxLength) return fileName;
  const ext = fileName.split(".").pop();
  const nameWithoutExt = fileName.slice(0, -(ext.length + 1));
  return nameWithoutExt.slice(0, maxLength - 3 - ext.length) + "..." + ext;
}

function addSegment() {
  const newSegment = document.createElement("div");
  newSegment.className = "time-segment fade-in";
  newSegment.innerHTML = `
          <input type="text" name="start_time_${segmentCount}" class="start-time" pattern="^(?:(?:([0-9]{1,2}):)?([0-5]?[0-9]):)?([0-5]?[0-9])$" placeholder="Start time (HH:MM:SS)" required>
          <input type="text" name="end_time_${segmentCount}" class="end-time" pattern="^(?:(?:([0-9]{1,2}):)?([0-5]?[0-9]):)?([0-5]?[0-9])$" placeholder="End time (HH:MM:SS)" required>
          <button type="button" class="remove-segment" onclick="removeSegment(this)">×</button>
      `;
  timeSegmentsContainer.appendChild(newSegment);
  segmentCount++;
}

function removeSegment(button) {
  if (timeSegmentsContainer.children.length > 1) {
    button.parentElement.remove();
  } else {
    alert("You must have at least one time segment.");
  }
}

addSegmentButton.addEventListener("click", addSegment);

function renderDirectoryStructure(items) {
  directoryBrowser.innerHTML = "";
  if (currentPath) {
    const parentItem = document.createElement("div");
    parentItem.classList.add("directory-item");
    parentItem.innerHTML = `
<span class="directory-item-name">.. (Parent Directory)</span>
`;
    parentItem.onclick = () => loadDirectory(currentPath.split("/").slice(0, -1).join("/"));
    directoryBrowser.appendChild(parentItem);
  }
  items.forEach((item) => {
    const itemElement = document.createElement("div");
    itemElement.classList.add("directory-item");
    if (item.type === "file") {
      itemElement.classList.add("file");
      const truncatedName = truncateFileName(item.name);
      itemElement.innerHTML = `
  <span class="directory-item-name" title="${item.name}">${truncatedName}</span>
  <span class="file-size">${formatFileSize(item.size)}</span>
`;
      itemElement.onclick = () => selectFile(item.path, item.name, itemElement);
    } else {
      itemElement.innerHTML = `
  <span class="directory-item-name">${item.name}</span>
`;
      itemElement.onclick = () => loadDirectory(item.path);
    }
    directoryBrowser.appendChild(itemElement);
  });
}

function selectFile(path, name, element) {
  document.querySelectorAll(".directory-item").forEach((item) => {
    item.classList.remove("selected");
  });
  element.classList.add("selected");
  selectedFile.value = path;
  selectedFileDisplay.textContent = `Selected: ${name}`;
  customPath.value = "";
}

function loadDirectory(path) {
  currentPath = path;
  fetch("/list_directory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: path }),
  })
    .then((response) => response.json())
    .then((data) => {
      renderDirectoryStructure(data);
    })
    .catch((error) => {
      console.error("Error:", error);
      errorMessage.textContent = "Failed to load directory";
    });
}

// Initial directory load
loadDirectory("");

customPath.addEventListener("input", () => {
  if (customPath.value) {
    selectedFile.value = "";
    selectedFileDisplay.textContent = "";
    document.querySelectorAll(".directory-item").forEach((item) => {
      item.classList.remove("selected");
    });
  }
});

trimForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMessage.textContent = "";
  progressContainer.style.display = "none";
  downloadLink.style.display = "none";

  // Reset and show progress bar
  progressBarFill.style.width = "0%";
  progressBarFill.classList.add("progress-striped");
  progressText.textContent = "0%";
  progressContainer.style.display = "block";

  const formData = new FormData(trimForm);

  // Collect all time segments
  const timeSegments = [];
  const startInputs = trimForm.querySelectorAll('input[name^="start_time"]');
  const endInputs = trimForm.querySelectorAll('input[name^="end_time"]');

  for (let i = 0; i < startInputs.length; i++) {
    timeSegments.push({
      start_time: startInputs[i].value,
      end_time: endInputs[i].value,
    });
  }

  // Add time segments to formData
  formData.append("time_segments", JSON.stringify(timeSegments));

  try {
    const response = await fetch("/trim", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (response.ok) {
      startProgressMonitoring(data.job_id, data.file_name);
    } else {
      errorMessage.textContent = data.error || "An error occurred";
      progressContainer.style.display = "none";
    }
  } catch (error) {
    errorMessage.textContent = "An error occurred";
    console.error("Error:", error);
    progressContainer.style.display = "none";
  }
});

function startProgressMonitoring(jobId, fileName) {
  progressContainer.style.display = "block";
  const eventSource = new EventSource(`/progress/${jobId}`);
  let lastProgress = 0;

  // Reset progress bar
  progressBarFill.style.width = "0%";
  progressBarFill.classList.add("striped");
  progressText.textContent = "0%";

  function updateProgressBar(progress) {
    progressBarFill.style.width = `${progress}%`;
    progressText.textContent = `${Math.round(progress)}%`;
  }

  function animateProgress(start, end, duration) {
    const startTime = performance.now();

    function step(currentTime) {
      const elapsedTime = currentTime - startTime;
      if (elapsedTime < duration) {
        const progress = start + (end - start) * (elapsedTime / duration);
        updateProgressBar(progress);
        requestAnimationFrame(step);
      } else {
        updateProgressBar(end);
      }
    }

    requestAnimationFrame(step);
  }

  eventSource.onmessage = function (event) {
    const data = JSON.parse(event.data);
    const newProgress = Math.max(lastProgress, Math.min(data.progress, 100));

    if (newProgress > lastProgress) {
      animateProgress(lastProgress, newProgress, 500);
      lastProgress = newProgress;
    }

    if (newProgress === 100 || newProgress === -1) {
      eventSource.close();
      if (newProgress === 100) {
        downloadButton.href = `/download_trimmed/${fileName}`;
        downloadLink.style.display = "block";
        progressBarFill.classList.remove("striped");

        // Fetch trimmed video info
        fetch(`/video_info/${jobId}`)
          .then((response) => response.json())
          .then((data) => {
            const trimmedVideoInfo = document.getElementById("trimmed-video-info");
            trimmedVideoInfo.textContent = `Trimmed video size: ${formatFileSize(data.size)}`;
          })
          .catch((error) => {
            console.error("Error fetching video info:", error);
          });
      } else {
        errorMessage.textContent = "An error occurred while trimming the video";
        progressContainer.style.display = "none";
      }
    }
  };

  eventSource.onerror = function (event) {
    console.error("EventSource failed:", event);
    eventSource.close();
    errorMessage.textContent = "An error occurred while trimming the video";
    progressContainer.style.display = "none";
    progressBarFill.classList.remove("striped");
  };
}

// Update the form submission to reset the progress bar
trimForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMessage.textContent = "";
  progressContainer.style.display = "none";
  downloadLink.style.display = "none";

  // Reset and show progress bar
  progressBarFill.style.width = "0%";
  progressBarFill.classList.add("striped");
  progressText.textContent = "0%";
  progressContainer.style.display = "block";

  const formData = new FormData(trimForm);

  // Collect all time segments
  const timeSegments = [];
  const startInputs = trimForm.querySelectorAll('input[name^="start_time"]');
  const endInputs = trimForm.querySelectorAll('input[name^="end_time"]');

  for (let i = 0; i < startInputs.length; i++) {
    timeSegments.push({
      start_time: startInputs[i].value,
      end_time: endInputs[i].value,
    });
  }

  // Add time segments to formData
  formData.append("time_segments", JSON.stringify(timeSegments));

  try {
    const response = await fetch("/trim", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (response.ok) {
      startProgressMonitoring(data.job_id, data.file_name);
    } else {
      errorMessage.textContent = data.error || "An error occurred";
      progressContainer.style.display = "none";
      progressBarFill.classList.remove("striped");
    }
  } catch (error) {
    errorMessage.textContent = "An error occurred";
    console.error("Error:", error);
    progressContainer.style.display = "none";
    progressBarFill.classList.remove("striped");
  }
});
