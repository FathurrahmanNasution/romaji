const worker = new Worker('./js/romaji-worker.js');
worker.onmessage = (e) => {
  console.log("Worker replied:", e.data);
};
worker.postMessage({ id: 1, type: 'CONVERT', payload: [{ text: "正しいだけで" }] });
