(function () {
    var canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    function draw() {
        var W = window.innerWidth;
        var H = window.innerHeight;
        canvas.width = W;
        canvas.height = H;

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, W, H);

        var count = Math.floor((W * H) / 18000);
        var pts = [];
        for (var i = 0; i < count; i++) {
            pts.push([Math.random() * W, Math.random() * H]);
        }

        var step = 3;
        var cells = [];
        for (var y = 0; y <= H; y += step) {
            for (var x = 0; x <= W; x += step) {
                var best = 0, bestD = Infinity, second = Infinity;
                for (var k = 0; k < pts.length; k++) {
                    var dx = x - pts[k][0], dy = y - pts[k][1];
                    var d = dx * dx + dy * dy;
                    if (d < bestD) { second = bestD; bestD = d; best = k; }
                    else if (d < second) { second = d; }
                }
                cells.push({ x: x, y: y, d1: bestD, d2: second });
            }
        }

        ctx.fillStyle = 'rgba(23, 204, 236, 0.13)';
        for (var i = 0; i < cells.length; i++) {
            var c = cells[i];
            if (Math.sqrt(c.d1) / Math.sqrt(c.d2) > 0.87) {
                ctx.fillRect(c.x, c.y, step, step);
            }
        }

        ctx.fillStyle = 'rgba(23, 204, 236, 0.18)';
        for (var i = 0; i < pts.length; i++) {
            ctx.beginPath();
            ctx.arc(pts[i][0], pts[i][1], 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    draw();
    window.addEventListener('resize', draw);
})();
