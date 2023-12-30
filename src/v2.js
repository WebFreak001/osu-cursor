// @ts-check

const easings = {
	cubic: function (t) { return (t - 1) * (t - 1) * (t - 1) + 1; },
	quintic: function (t) { return (t - 1) * (t - 1) * (t - 1) * (t - 1) * (t - 1) + 1; },
	sin1: function (t) { return Math.pow(2, -10 * t) * Math.sin((0.5 * t - 0.075) * 20.943951023931955) + 1 - 0.0004882812499999998 * t; },
	sin2: function (t) { return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * 20.943951023931955) + 1 - 0.00048828125 * t; },
	ease: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
};

function lerp(a, b, t) {
	return a * (1 - t) + b * t;
}

/**
 * @typedef {Object} Transition
 * @property {number} duration - The time to animate
 * @property {number} progress - The ms that were animated
 * @property {boolean} [disabled] - If true, this transition will not be processed
 * @property {boolean} [persistent] - The ms that were animated
 * @property {(t: number) => number} easing - The easing function to apply
 * @property {string} target - The property to change
 * @property {any} start - The value at the start
 * @property {any} end - The desired target value
 * @property {Function} [complete] - Callback
 */

class osuCursor {
	/**
	 *
	 * @param {HTMLCanvasElement} canvas
	 * @param {{ debug?: boolean, rotate?: boolean }} [options]
	 */
	constructor(canvas, options) {
		if (!canvas)
			canvas = document.createElement("canvas");
		canvas.width = 128;
		canvas.height = 128;
		this.currentCursor = "default";
		this.canvas = canvas;
		this.cursorCanvas = document.createElement("canvas");
		let cursorContext = this.cursorCanvas.getContext("2d");
		if (!cursorContext)
			throw new Error("Unable to create context for cursor");
		this.cursorContext = cursorContext;
		let context = canvas.getContext("2d");
		if (!context)
			throw new Error("Unable to create context");

		this.stylesheet = document.createElement("style");
		this.stylesheet.textContent = "* { cursor: inherit; }";
		document.head.appendChild(this.stylesheet);
		let htmlStyle = document.querySelector("html")?.style;
		if (!htmlStyle)
			throw new Error("missing HTML style");
		this.htmlStyle = htmlStyle;

		/**
		 * @type {CanvasRenderingContext2D}
		 */
		this.context = context;
		this.debug = (options && options.debug) || false;
		this.rotate = options ? options.rotate : undefined;
		if (this.rotate === undefined) this.rotate = true;
		this.state = {
			global: {
				scale: 1.0,
				rotate: 0.0,
				/** @type {Transition[]} */
				transitions: [
					{
						duration: 150,
						easing: easings.ease,
						start: 0,
						end: 0,
						persistent: true,
						progress: 0,
						target: "rotate"
					}
				]
			},
			inner: {
				scale: 1.0,
				/** @type {Transition[]} */
				transitions: []
			},
			overlay: {
				opacity: 1.0,
				/** @type {Transition[]} */
				transitions: []
			}
		};

		this.cursorBase = new Image();
		this.cursorBase.src = "../assets/cursor.png";
		this.cursorBase.onload = this.forceRender.bind(this);
		this.cursorOverlay = new Image();
		this.cursorOverlay.src = "../assets/cursor-additive.png";
		this.cursorOverlay.onload = this.forceRender.bind(this);

		/*
		 * -1 - native browser dragging
		 *  0 - not dragging (default)
		 *  1 - start dragging
		 *  2 - dragging and rotating
		 *  3 - pointer
		 */
		this.dragState = 0;
		this.dragStartPos = { x: 0, y: 0 };
		this.rotateState = {
			isInAnimation: false,
			radians: 0
		}
		this.isTouch = false;

		this.mouseMoveFunc = this.mouseMove.bind(this);
		this.mouseOverFunc = this.mouseOver.bind(this);
		this.mouseDownFunc = this.mouseDown.bind(this);
		this.mouseUpFunc = this.mouseUp.bind(this);
		this.dragFunc = this.drag.bind(this);
		this.dragEndFunc = this.dragEnd.bind(this);
		this.touchFunc = this.touch.bind(this);
		document.addEventListener('mousemove', this.mouseMoveFunc, { passive: true });
		document.addEventListener('mouseover', this.mouseOverFunc, { passive: true });
		document.addEventListener('mousedown', this.mouseDownFunc, { passive: true });
		document.addEventListener('touchstart', this.touchFunc, { passive: true });
		document.addEventListener('touchmove', this.touchFunc, { passive: true });
		document.addEventListener('mouseup', this.mouseUpFunc, { passive: true });
		document.addEventListener('drag', this.dragFunc, { passive: true });
		document.addEventListener('dragend', this.dragEndFunc, { passive: true });

		this.forceRender();
	}


	getParentAttribute(element, attributeName) {
		let value = element.getAttribute(attributeName);
		if (value)
			return value;
		let parent = element.parentElement;
		if (parent) {
			return this.getParentAttribute(parent, attributeName);
		}
		return null;
	}

	getCurrentCursorStyle(target) {
		// TODO: cache per-element
		let c = this.htmlStyle.getPropertyValue("cursor");
		this.htmlStyle.cursor = "";
		this.stylesheet.disabled = true;
		let cursorStyle = getComputedStyle(target).cursor;
		this.htmlStyle.setProperty("cursor", c, "important");
		this.stylesheet.disabled = false;
		return cursorStyle;
	}

	mouseMove(e) {
		if (this.isTouch) {
			this.isTouch = false;
			return;
		}
		if ((this.dragState == 1 || this.dragState == 2) && this.rotate) {
			const deltaX = e.pageX - window.pageXOffset - this.dragStartPos.x;
			const deltaY = e.pageY - window.pageYOffset - this.dragStartPos.y;

			if (deltaX * deltaX + deltaY * deltaY > 30 * 30) {
				this.dragState = 2;
			} else {
				return;
			}

			let radians = Math.atan2(-deltaX, deltaY) + deg2rad(24.3);

			let diff = (radians - this.rotateState.radians) % (2 * Math.PI);
			if (diff < -Math.PI) diff += 2 * Math.PI;
			if (diff > Math.PI) diff -= 2 * Math.PI;
			this.rotateState.radians += diff;
			// this.state.global.transitions[0].end = 0;
			this.state.global.transitions[0].end = this.rotateState.radians;
			this.forceRender();
		}
	}

	mouseDown(e) {
		if (this.isTouch) {
			this.isTouch = false;
			return;
		}

		this.dragStartPos.x = e.pageX - window.pageXOffset;
		this.dragStartPos.y = e.pageY - window.pageYOffset;
		this.rotateState.radians = 0;
		// this.cursor.classList.add("active");
		this.state.inner.transitions = [];
		animate(this.state.inner, {
			scale: 0.9,
			duration: 800,
			easing: easings.cubic
		});
		this.state.overlay.transitions = [];
		animate(this.state.overlay, {
			opacity: this.dragState == 3 ? 1 : [0, 1],
			duration: 800,
			easing: easings.quintic
		});
		this.dragState = 1;
		this.forceRender();
	}

	mouseUp(e) {
		if (this.dragState == 2) {
			this.rotateState.isInAnimation = true;
			this.state.global.transitions.splice(1);
			this.state.global.transitions[0].disabled = true;
			animate(this.state.global, {
				rotate: 0,
				duration: 600 * (1 + Math.abs(this.rotateState.radians / 4 / Math.PI)),
				easing: easings.sin1,
				complete: () => {
					this.state.global.transitions[0].disabled = false;
					this.state.global.transitions[0].end = 0;
					this.rotateState.isInAnimation = false; new Event('click');
					this.forceRender();
				}
			});
		}
		this.dragState = 0;
		// this.cursor.classList.remove("active");
		this.state.inner.transitions = [];
		animate(this.state.inner, {
			scale: 1,
			duration: 500,
			easing: easings.sin2
		});
		this.state.overlay.transitions = [{
			duration: 500,
			progress: 0,
			easing: easings.quintic,
			target: "opacity",
			start: 1,
			end: 0,
		}];
		this.forceRender();
	}

	mouseOver(e) {
		if (this.dragState == 1 || this.dragState == 2) {
			return;
		}
		this.currentCursor = this.getCurrentCursorStyle(e.target);
		console.log(this.currentCursor);
		if (["default", "auto", "none"].includes(this.currentCursor)) {
			if (this.dragState == 3) {
				this.dragState = 0;
				this.state.overlay.transitions = [];
				animate(this.state.overlay, {
					opacity: 0,
					duration: 200,
					easing: easings.quintic
				});
				animate(this.state.global, {
					rotate: 0,
					duration: 150,
					easing: easings.ease
				});
				this.forceRender();
			}
		} else if (this.currentCursor == "pointer") {
			if (this.dragState == 0 && !this.rotateState.isInAnimation) {
				this.dragState = 3;
				this.state.global.transitions.splice(1);
				this.state.global.transitions[0].end = deg2rad(24.3);
				this.state.overlay.transitions = [];
				animate(this.state.overlay, {
					opacity: 1,
					duration: 200,
					easing: easings.quintic
				});
				this.forceRender();
			}
		}
	}

	drag(e) {
		this.dragState = -1;
	}

	dragEnd(e) {
		// this.cursor.style.display = "block";
		// this.cursor.classList.remove("active");
		this.state.overlay.transitions = [];
		this.state.overlay.opacity = 0;
		this.state.global.transitions.splice(1);
		this.state.global.transitions[0].end = 0;
		this.state.inner.transitions = [];
		this.state.inner.scale = 1;
		this.dragState = 0;
		this.forceRender();
	}

	touch(e) {
		this.isTouch = true;
	}

	stop() {
		document.removeEventListener('mousemove', this.mouseMoveFunc);
		document.removeEventListener('mouseover', this.mouseOverFunc);
		document.removeEventListener('mousedown', this.mouseDownFunc);
		document.removeEventListener('touchstart', this.touchFunc);
		document.removeEventListener('touchmove', this.touchFunc);
		document.removeEventListener('mouseup', this.mouseUpFunc);
		document.removeEventListener('drag', this.dragFunc);
		document.removeEventListener('dragend', this.dragEndFunc);
	}

	forceRender() {
		requestAnimationFrame(this.render.bind(this));
	}

	redraw() {
		this.context.resetTransform();
		this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.context.translate(this.canvas.width / 2, this.canvas.height / 2);

		this.context.rotate(this.state.global.rotate);
		this.context.translate(-4, -3);
		this.context.scale(this.state.global.scale, this.state.global.scale);

		this.context.scale(this.state.inner.scale, this.state.inner.scale);
		this.context.globalCompositeOperation = "copy";
		this.context.drawImage(this.cursorBase, 0, 0, this.cursorBase.width / 10, this.cursorBase.height / 10);
		this.context.globalCompositeOperation = "lighter";
		this.context.globalAlpha = this.state.overlay.opacity;
		this.context.drawImage(this.cursorOverlay, 0, 0, this.cursorOverlay.width / 10, this.cursorOverlay.height / 10);
		this.context.globalAlpha = 1.0;

		var bounds = [
			this.context.getTransform().transformPoint(new DOMPoint(-2, -3)),
			this.context.getTransform().transformPoint(new DOMPoint(this.cursorBase.width / 10, this.cursorBase.height / 20 - 4)),
			this.context.getTransform().transformPoint(new DOMPoint(-2, this.cursorBase.height / 10)),
			this.context.getTransform().transformPoint(new DOMPoint(this.cursorBase.width / 10, this.cursorBase.height / 10)),
		];
		let x1 = Math.floor(Math.min(bounds[0].x, bounds[1].x, bounds[2].x, bounds[3].x));
		let y1 = Math.floor(Math.min(bounds[0].y, bounds[1].y, bounds[2].y, bounds[3].y));
		let x2 = Math.ceil(Math.max(bounds[0].x, bounds[1].x, bounds[2].x, bounds[3].x));
		let y2 = Math.ceil(Math.max(bounds[0].y, bounds[1].y, bounds[2].y, bounds[3].y));
		let w = x2 - x1;
		let h = y2 - y1;

		this.cursorCanvas.width = w;
		this.cursorCanvas.height = h;
		this.cursorContext.clearRect(0, 0, w, h);
		this.cursorContext.drawImage(this.canvas, x1, y1, w, h, 0, 0, w, h);

		let cx = 64 - x1;
		let cy = 64 - y1;

		if (this.debug) {
			this.context.resetTransform();
			this.context.globalCompositeOperation = "overlay";
			this.context.beginPath();
			this.context.fillStyle = "blue";
			this.context.fillRect(63.5, 63.5, 1, 1);
			this.context.strokeStyle = "red";
			this.context.lineWidth = 1.0;
			this.context.strokeRect(x1 - 0.5, y1 - 0.5, w + 1, h + 1);
		}

		// this makes updates with regular cursor faster
		this.htmlStyle.setProperty("cursor",
			"url(" + this.cursorCanvas.toDataURL() + ") "
			+ cx + " " + cy
			+ ", " + this.currentCursor,
			"important"
		);
	}

	render(timeStamp) {
		if (this.startTime === undefined) {
			this.startTime = timeStamp;
		}
		const elapsed = timeStamp - this.startTime;
		this.startTime = timeStamp;
		console.log(elapsed);

		let animated = false;
		animated = this.processState(elapsed, this.state.global) || animated;
		animated = this.processState(elapsed, this.state.inner) || animated;
		animated = this.processState(elapsed, this.state.overlay) || animated;

		this.redraw();

		if (animated)
			requestAnimationFrame(this.render.bind(this));
	}

	/**
	 * @param {number} delta
	 * @param {{[property: string]: any, transitions: Transition[] }} state
	 */
	processState(delta, state) {
		let changed = false;

		for (let i = state.transitions.length - 1; i >= 0; i--) {
			const transition = state.transitions[i];
			if (transition.disabled)
				continue;
			if (transition.persistent && transition.end === state[transition.target])
				continue;

			transition.progress += delta;
			if (transition.progress >= transition.duration) {
				state[transition.target] = transition.end;
				transition.progress = transition.duration;
				if (transition.complete)
					transition.complete();
				if (!transition.persistent)
					state.transitions.splice(i, 1);
				else {
					transition.progress = 0;
					transition.start = transition.end;
				}
			} else {
				const t = transition.easing(transition.progress / transition.duration);
				state[transition.target] = lerp(transition.start, transition.end, t);
			}

			changed = true;
		}

		return changed;
	}
}

/**
 * 
 * @param {{[prop: string]: any, transitions: Transition[]}} state
 * @param {{[newProp: keyof state]: any, duration: number, easing: (t: number) => number, complete?: Function}} options
 */
function animate(state, options) {
	let duration = options.duration;
	let easing = options.easing;
	let complete = options.complete;
	Object.keys(options).forEach((key) => {
		if (key != "duration" && key != "easing" && key != "complete") {
			state.transitions.push({
				duration: duration,
				easing: easing,
				progress: 0,
				target: key,
				start: state[key],
				end: options[key],
				complete: complete
			});
			complete = undefined;
		}
	});
}

function deg2rad(deg) {
	return deg / 180.0 * Math.PI;
}
