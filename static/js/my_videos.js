let videoData = JSON.parse(document.getElementById('video-container').dataset.videos);
let filteredVideos = [...videoData];
let currentPage = 1;
const itemsPerPage = 10;
let currentSort = { field: 'filename', order: 'asc' };

const noVideosMessage = document.getElementById('no-videos-message');
const videoTable = document.querySelector('.video-table');
const paginationDiv = document.querySelector('.pagination');

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function renderTable() {
    const tableBody = document.getElementById('video-table-body');
    if (filteredVideos.length === 0) {
        noVideosMessage.style.display = 'block';
        videoTable.style.display = 'none';
        paginationDiv.style.display = 'none';
        return;
    }

    noVideosMessage.style.display = 'none';
    videoTable.style.display = 'table';
    paginationDiv.style.display = 'flex';

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageVideos = filteredVideos.slice(startIndex, endIndex);

    tableBody.innerHTML = pageVideos.map(video => `
        <tr>
            <td>${video.filename}</td>
            <td>${new Date(video.date_added).toLocaleString()}</td>
            <td>${formatFileSize(video.file_size)}</td>
            <td>
                <div class="action-buttons">
                    <a href="/download_trimmed/${video.filename}" class="download-button">Download</a>
                    <button class="delete-button" data-video-id="${video.id}">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');

    updatePagination();
    attachDeleteListeners();
}

    function updatePagination() {
        const pageInfo = document.getElementById('page-info');
        const totalPages = Math.ceil(filteredVideos.length / itemsPerPage);
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

        document.getElementById('prev-page').disabled = currentPage === 1;
        document.getElementById('next-page').disabled = currentPage === totalPages;
    }

    function sortVideos(field, order) {
        filteredVideos.sort((a, b) => {
            if (a[field] < b[field]) return order === 'asc' ? -1 : 1;
            if (a[field] > b[field]) return order === 'asc' ? 1 : -1;
            return 0;
        });
        currentSort = { field, order };
        currentPage = 1;
        renderTable();
        updateSortIndicators();
    }

    function updateSortIndicators() {
        document.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.sort === currentSort.field) {
                th.classList.add(currentSort.order);
            }
        });
    }

    document.getElementById('search-input').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filteredVideos = videoData.filter(video => 
            video.filename.toLowerCase().includes(searchTerm)
        );
        currentPage = 1;
        renderTable();
    });

    document.getElementById('sort-select').addEventListener('change', (e) => {
        const [field, order] = e.target.value.split('-');
        sortVideos(field, order);
    });

    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            const order = currentSort.field === field && currentSort.order === 'asc' ? 'desc' : 'asc';
            sortVideos(field, order);
        });
    });

    document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });

    document.getElementById('next-page').addEventListener('click', () => {
        if (currentPage < Math.ceil(filteredVideos.length / itemsPerPage)) {
            currentPage++;
            renderTable();
        }
    });

    function attachDeleteListeners() {
        document.querySelectorAll('.delete-button').forEach(button => {
            button.addEventListener('click', function() {
                const videoId = this.getAttribute('data-video-id');
                if (confirm('Are you sure you want to delete this video?')) {
                    deleteVideo(videoId);
                }
            });
        });
    }

    function deleteVideo(videoId) {
    fetch(`/delete_video/${videoId}`, { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                filteredVideos = filteredVideos.filter(video => video.id != videoId);
                videoData = videoData.filter(video => video.id != videoId);
                currentPage = 1; // Reset to first page after deletion
                renderTable();
            } else {
                alert('Failed to delete video. Please try again.');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred. Please try again.');
        });
}

    renderTable();
    updateSortIndicators();