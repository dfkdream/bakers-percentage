/*
Copyright (C) 2025 dfkdream

This file is part of bakers-percentage.
bakers-percentage is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
bakers-percentage is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>. 
*/

// 상태 관리
let rows = [
  { id: 1, name: "강력분", weight: 1000, percent: 100, isFlour: true },
  { id: 2, name: "물", weight: 700, percent: 70, isFlour: false },
  { id: 3, name: "이스트", weight: 10, percent: 1, isFlour: false },
  { id: 4, name: "소금", weight: 20, percent: 2, isFlour: false },
];

// Compression Streams API 참고자료: 
// https://gist.github.com/Explosion-Scratch/357c2eebd8254f8ea5548b0e6ac7a61b
// https://stackoverflow.com/questions/49349960/

const compressionFormat = "deflate-raw";
const b64Options = {alphabet: "base64url"};

async function compress(rows) {
  // 데이터 최소화 (n:name, w:weight, p:percent, f:isFlour(1/0))
  const minimized = rows.map((r) => ({
    n: r.name,
    w: formatNum(r.weight),
    p: formatNum(r.percent),
    f: r.isFlour ? 1 : 0,
  }));

  const jsonStr = JSON.stringify(minimized);

  // 데이터 압축
  const byteArray = new TextEncoder().encode(jsonStr);
  const cstream = new CompressionStream(compressionFormat);
  const writer = cstream.writable.getWriter();
  writer.write(byteArray);
  writer.close();

  const buffer = await new Response(cstream.readable).bytes();

  return buffer.toBase64(b64Options);
}

async function decompress(data) {
  // 데이터 압축 해제
  const buffer = Uint8Array.fromBase64(data, b64Options);
  const dstream = new DecompressionStream(compressionFormat);
  const writer = dstream.writable.getWriter();
  writer.write(buffer);
  writer.close();

  const byteArray = await new Response(dstream.readable).bytes();
  const decoded = new TextDecoder().decode(byteArray);

  // 키 압축 해제 (n:name, w:weight, p:percent, f:isFlour)
  const parsed = JSON.parse(decoded);

  return parsed.map((r, index) => ({
    id: index + 1,
    name: r.n,
    weight: parseFloat(r.w) || 0,
    percent: parseFloat(r.p) || 0,
    isFlour: r.f === 1,
  }));
}

// 구버전 호환
function decompress_old(data) {
  const decoded = decodeURIComponent(escape(atob(data)));

  // 키 압축 해제 (n:name, w:weight, p:percent, f:isFlour)
  const parsed = JSON.parse(decoded);

  return parsed.map((r, index) => ({
    id: index + 1,
    name: r.n,
    weight: parseFloat(r.w) || 0,
    percent: parseFloat(r.p) || 0,
    isFlour: r.f === 1,
  }));
}

// 초기화 및 URL 파라미터 로드
window.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const data = urlParams.get("data");
  if (data) {
    try {
      rows = await decompress(data);
    } catch (err) {
      console.log(err);

      // 구버전 호환
      try {
        rows = decompress_old(data);
      } catch (err) {
        alert("데이터 로드에 실패했습니다.");
        console.log(err);
      }
    }
  }
  renderTable();
  updateSummary();
});

// 테이블 렌더링
function renderTable() {
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.dataset.index = index;
    tr.innerHTML = `
                <td><input type="checkbox" class="is-flour-check" ${
                  row.isFlour ? "checked" : ""
                } onchange="toggleFlour(${index})"></td>
                <td class="align-left"><input type="text" value="${
                  row.name
                }" placeholder="재료명" oninput="updateRow(${index}, 'name', this.value)" onkeydown="handleKeyDown(event, ${index}, 0)"></td>
                <td class="align-right"><input type="number" step="0.1" class="weight-input" value="${formatNum(
                  row.weight
                )}" oninput="updateWeight(${index}, this.value)" onkeydown="handleKeyDown(event, ${index}, 1)"></td>
                <td class="align-right"><input type="number" step="0.1" class="percent-input" value="${formatNum(
                  row.percent
                )}" oninput="updatePercent(${index}, this.value)" onkeydown="handleKeyDown(event, ${index}, 2)"></td>
                <td><button class="btn-icon" onclick="deleteRow(${index})" tabindex="-1">×</button></td>
            `;
    tbody.appendChild(tr);
  });
}

// 숫자 포맷팅 (소수점 정리)
function formatNum(num) {
  return Math.round(num * 100) / 100; // 소수점 둘째 자리 반올림
}

// 데이터 업데이트 핸들러
function updateRow(index, key, value) {
  rows[index][key] = value;
  updateUrl(); // 실시간 URL 업데이트는 아니지만 변경 상태 기록용
}

function toggleFlour(index) {
  rows[index].isFlour = !rows[index].isFlour;
  recalcPercentFromWeights(); // 가루 기준이 바뀌었으므로 퍼센트 재계산
}

// 무게 입력 시 핸들러
function updateWeight(index, value) {
  const val = parseFloat(value) || 0;
  const isScaleMode = document.getElementById("scaleMode").checked;

  // 비율 고정 모드이면서 퍼센트가 0이 아닐 때 -> 전체 배합 크기 조절 (역산)
  if (isScaleMode && rows[index].percent > 0) {
    // 목표: rows[index].weight 가 val이 되도록 전체 스케일 조정
    // 공식: 변경된 재료의 무게 / (해당 재료의 % / 100) = 새로운 총 밀가루 무게
    const targetTotalFlour = val / (rows[index].percent / 100);

    // 전체 재료 무게 재계산
    rows.forEach((row) => {
      row.weight = (targetTotalFlour * row.percent) / 100;
    });

    // 입력 필드 포커스 잃지 않게 하면서 값 업데이트
    refreshTableValues();
    // 현재 입력 중인 필드는 강제로 값을 유지 (소수점 입력 중 튀는 것 방지)
    // 하지만 전체 갱신이므로 자연스럽게 보정됨.
  } else {
    // 일반 모드: 무게 변경 시 -> 해당 재료의 비율 재계산 (레시피 수정)
    rows[index].weight = val;
    recalcPercentFromWeights();
  }

  updateSummary();
  updateUrl();
}

// 퍼센트 입력 시 -> 무게 역산
function updatePercent(index, value) {
  const val = parseFloat(value) || 0;
  rows[index].percent = val;

  const totalFlour = getCalculatedTotalFlour();
  if (totalFlour > 0) {
    rows[index].weight = (totalFlour * val) / 100;
    // UI 업데이트 (현재 행 무게만)
    const tr = document.getElementById("tableBody").children[index];
    tr.querySelector(".weight-input").value = formatNum(rows[index].weight);
    updateSummary();
    updateUrl();
  }
}

// 전체 가루 무게 계산
function getCalculatedTotalFlour() {
  return rows.reduce((sum, row) => (row.isFlour ? sum + row.weight : sum), 0);
}

// 무게 기반 모든 퍼센트 재계산
function recalcPercentFromWeights() {
  const totalFlour = getCalculatedTotalFlour();

  rows.forEach((row, idx) => {
    if (totalFlour === 0) {
      row.percent = 0;
    } else {
      row.percent = (row.weight / totalFlour) * 100;
    }
  });

  // UI 전체 리프레시 없이 값만 업데이트 (포커스 유지 위해)
  refreshTableValues();
  updateSummary();
  updateUrl();
}

// 값만 업데이트 (DOM 재생성 방지)
function refreshTableValues() {
  const tbody = document.getElementById("tableBody");
  Array.from(tbody.children).forEach((tr, idx) => {
    const row = rows[idx];
    // 현재 포커스 된 요소인지 확인
    const weightInput = tr.querySelector(".weight-input");
    const percentInput = tr.querySelector(".percent-input");

    // 포커스가 없거나, 값이 다를 때만 업데이트 (입력 중 커서 튐 방지)
    if (document.activeElement !== weightInput) {
      weightInput.value = formatNum(row.weight);
    }
    if (document.activeElement !== percentInput) {
      percentInput.value = formatNum(row.percent);
    }
  });
}

// 총계 표시 업데이트
function updateSummary() {
  const totalFlour = getCalculatedTotalFlour();
  const totalDough = rows.reduce((sum, row) => sum + row.weight, 0);

  document.getElementById("totalFlourWeight").value = formatNum(totalFlour);
  document.getElementById("totalDoughWeight").value = formatNum(totalDough);
}

// 상단 '총 가루 무게' 수정 시 -> 비율 고정, 전체 무게 스케일링
function scaleByFlour() {
  const newTotalFlour =
    parseFloat(document.getElementById("totalFlourWeight").value) || 0;

  // 기존 비율을 유지하며 무게만 변경
  rows.forEach((row) => {
    row.weight = (newTotalFlour * row.percent) / 100;
  });

  refreshTableValues();
  document.getElementById("totalDoughWeight").value = formatNum(
    rows.reduce((s, r) => s + r.weight, 0)
  );
  updateUrl();
}

// 상단 '총 반죽 무게' 수정 시 -> 비율 고정, 전체 무게 스케일링
function scaleByDough() {
  const newTotalDough =
    parseFloat(document.getElementById("totalDoughWeight").value) || 0;
  const currentTotalPercent = rows.reduce((sum, row) => sum + row.percent, 0);

  if (currentTotalPercent === 0) return;

  // 공식: 총반죽무게 = 총가루무게 * (총퍼센트/100)
  // 역산: 총가루무게 = 총반죽무게 / (총퍼센트/100)
  const newTotalFlour = newTotalDough / (currentTotalPercent / 100);

  rows.forEach((row) => {
    row.weight = (newTotalFlour * row.percent) / 100;
  });

  document.getElementById("totalFlourWeight").value = formatNum(newTotalFlour);
  refreshTableValues();
  updateUrl();
}

// 행 추가/삭제
function addRow() {
  rows.push({
    id: Date.now(),
    name: "",
    weight: 0,
    percent: 0,
    isFlour: false,
  });
  renderTable();
  // 포커스 이동
  setTimeout(() => {
    const inputs = document.querySelectorAll('#tableBody input[type="text"]');
    inputs[inputs.length - 1].focus();
  }, 0);
}

function deleteRow(index) {
  if (rows.length <= 1) return;
  rows.splice(index, 1);
  renderTable();
  recalcPercentFromWeights();
}

function resetTable() {
  if (confirm("모든 내용을 초기화 하시겠습니까?")) {
    rows = [
      { id: 1, name: "밀가루", weight: 1000, percent: 100, isFlour: true },
    ];
    renderTable();
    recalcPercentFromWeights();
  }
}

// 키보드 네비게이션 (Excel-like)
function handleKeyDown(e, rowIndex, colIndex) {
  // colIndex: 0(name), 1(weight), 2(percent)
  const trs = document.getElementById("tableBody").children;
  const rowCount = trs.length;

  if (e.key === "Enter") {
    e.preventDefault();
    if (rowIndex === rowCount - 1) {
      // 마지막 행에서 엔터 -> 행 추가
      addRow();
    } else {
      // 다음 행 같은 열로 이동
      focusCell(rowIndex + 1, colIndex);
    }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (rowIndex < rowCount - 1) focusCell(rowIndex + 1, colIndex);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (rowIndex > 0) focusCell(rowIndex - 1, colIndex);
  } else if (e.key === "ArrowRight" || e.key === "Tab") {
    // 탭과 화살표는 기본 동작을 어느정도 허용하되, 마지막 셀에서 처리 필요
    // 여기서는 간단히 기본 탭 동작을 따르거나 커스텀 가능.
    // 화살표 좌우는 커서 이동과 겹치므로 caret 위치 확인이 필요하나 단순화를 위해 생략하거나
    // 입력값이 비어있거나 끝일 때만 이동하도록 할 수 있음.
    // 여기서는 단순 편의를 위해 방향키는 상하만 제어.
  }
}

function focusCell(rIndex, cIndex) {
  const tr = document.getElementById("tableBody").children[rIndex];
  if (!tr) return;
  const inputs = tr.querySelectorAll(
    'input[type="text"], input[type="number"]'
  );
  if (inputs[cIndex]) inputs[cIndex].focus();
}

// URL 공유 기능 (압축하여 파라미터 저장)
async function updateUrl() {
  const base64 = await compress(rows);

  const newUrl = `${window.location.pathname}?data=${base64}`;
  window.history.replaceState(null, "", newUrl);
  return window.location.href;
}

async function copyShareUrl() {
  const url = await updateUrl();
  navigator.clipboard
    .writeText(url)
    .then(() => showToast("URL이 복사되었습니다!"));
}

// Markdown 내보내기
async function exportMarkdown() {
  const currentUrl = await updateUrl(); // 최신 URL 갱신 및 가져오기

  let md = `| 재료명 | 무게 (g) | 비율 (%) |\n| :--- | :---: | :---: |\n`;
  rows.forEach((r) => {
    const mark = r.isFlour ? "**" : "";
    md += `| ${mark}${r.name}${mark} | ${formatNum(r.weight)} | ${formatNum(
      r.percent
    )} |\n`;
  });

  const totalW = document.getElementById("totalDoughWeight").value;
  md += `| **총계** | **${totalW}** | - |\n\n`;

  // 바로가기 링크 추가
  md += `[🍞 이 레시피를 계산기에서 열기](${currentUrl})`;

  navigator.clipboard
    .writeText(md)
    .then(() => showToast("Markdown 표와 링크가 복사되었습니다!"));
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.innerText = msg;
  toast.className = "show";
  setTimeout(() => {
    toast.className = toast.className.replace("show", "");
  }, 3000);
}
