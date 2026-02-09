const username = 'kenielf';
const apiUrl = `https://api.github.com/users/${username}/repos?per_page=25&page=`;
const prefix = `${username}/iac`;
const projectsContainer = document.querySelector('.infra');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let allRepos = [];
let page = 1;

async function fetchAllRepos() {
  while (true) {
    const res = await fetch(apiUrl + page);
    const repos = await res.json();

    if (!Array.isArray(repos) || repos.length === 0) break;

    allRepos.push(...repos);
    page++;

    await sleep(500); // 500ms delay
  }

  renderRepos(allRepos);
}

function renderRepos(repos) {
  repos
    .filter(repo => repo.full_name.toLowerCase().startsWith(prefix.toLowerCase()))
    .map(({
      full_name,
      description,
      fork,
      stargazers_count,
      language,
      license,
      html_url
    }) => ({
      full_name,
      description,
      fork,
      stargazers_count,
      language,
      license,
      html_url
    }))
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .forEach(repo => {
      const el = document.createElement('div');
      el.className = 'repo';
      el.innerHTML = `
        <h3><a href="${repo.html_url}" target="_blank">${repo.full_name}</a></h3>
        <p>${repo.description || 'No description available'}</p>
        <p>⭐ ${repo.stargazers_count} · ${repo.language || 'N/A'}</p>
      `;
      projectsContainer.appendChild(el);
    });
}

fetchAllRepos().catch(console.error);


