(function() {
	var Qt = function(t, e) {
		return Qt = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(n, r) {
			n.__proto__ = r;
		} || function(n, r) {
			for (var i in r) Object.prototype.hasOwnProperty.call(r, i) && (n[i] = r[i]);
		}, Qt(t, e);
	};
	function ni(t, e) {
		if (typeof e != "function" && e !== null) throw new TypeError("Class extends value " + String(e) + " is not a constructor or null");
		Qt(t, e);
		function n() {
			this.constructor = t;
		}
		t.prototype = e === null ? Object.create(e) : (n.prototype = e.prototype, new n());
	}
	var V = function() {
		return V = Object.assign || function(e) {
			for (var n, r = 1, i = arguments.length; r < i; r++) {
				n = arguments[r];
				for (var o in n) Object.prototype.hasOwnProperty.call(n, o) && (e[o] = n[o]);
			}
			return e;
		}, V.apply(this, arguments);
	};
	function yt(t, e, n) {
		if (n || arguments.length === 2) for (var r = 0, i = e.length, o; r < i; r++) (o || !(r in e)) && (o || (o = Array.prototype.slice.call(e, 0, r)), o[r] = e[r]);
		return t.concat(o || Array.prototype.slice.call(e));
	}
	var te = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : globalThis, J = Object.keys, q = Array.isArray;
	typeof Promise < "u" && !te.Promise && (te.Promise = Promise);
	function ie(t, e) {
		return typeof e != "object" || J(e).forEach(function(n) {
			t[n] = e[n];
		}), t;
	}
	var $e = Object.getPrototypeOf, ri = {}.hasOwnProperty;
	function re(t, e) {
		return ri.call(t, e);
	}
	function je(t, e) {
		typeof e == "function" && (e = e($e(t))), (typeof Reflect > "u" ? J : Reflect.ownKeys)(e).forEach(function(n) {
			ge(t, n, e[n]);
		});
	}
	var qn = Object.defineProperty;
	function ge(t, e, n, r) {
		qn(t, e, ie(n && re(n, "get") && typeof n.get == "function" ? {
			get: n.get,
			set: n.set,
			configurable: !0
		} : {
			value: n,
			configurable: !0,
			writable: !0
		}, r));
	}
	function ze(t) {
		return { from: function(e) {
			return t.prototype = Object.create(e.prototype), ge(t.prototype, "constructor", t), { extend: je.bind(null, t.prototype) };
		} };
	}
	var ii = Object.getOwnPropertyDescriptor;
	function Gn(t, e) {
		var n = ii(t, e), r;
		return n || (r = $e(t)) && Gn(r, e);
	}
	var oi = [].slice;
	function gt(t, e, n) {
		return oi.call(t, e, n);
	}
	function Yn(t, e) {
		return e(t);
	}
	function nt(t) {
		if (!t) throw new Error("Assertion Failed");
	}
	function Qn(t) {
		te.setImmediate ? setImmediate(t) : setTimeout(t, 0);
	}
	function ai(t, e) {
		return t.reduce(function(n, r, i) {
			var o = e(r, i);
			return o && (n[o[0]] = o[1]), n;
		}, {});
	}
	function pe(t, e) {
		if (typeof e == "string" && re(t, e)) return t[e];
		if (!e) return t;
		if (typeof e != "string") {
			for (var n = [], r = 0, i = e.length; r < i; ++r) {
				var o = pe(t, e[r]);
				n.push(o);
			}
			return n;
		}
		var a = e.indexOf(".");
		if (a !== -1) {
			var u = t[e.substr(0, a)];
			return u == null ? void 0 : pe(u, e.substr(a + 1));
		}
	}
	function oe(t, e, n) {
		if (!(!t || e === void 0) && !("isFrozen" in Object && Object.isFrozen(t))) if (typeof e != "string" && "length" in e) {
			nt(typeof n != "string" && "length" in n);
			for (var r = 0, i = e.length; r < i; ++r) oe(t, e[r], n[r]);
		} else {
			var o = e.indexOf(".");
			if (o !== -1) {
				var a = e.substr(0, o), u = e.substr(o + 1);
				if (u === "") n === void 0 ? q(t) && !isNaN(parseInt(a)) ? t.splice(a, 1) : delete t[a] : t[a] = n;
				else {
					var s = t[a];
					(!s || !re(t, a)) && (s = t[a] = {}), oe(s, u, n);
				}
			} else n === void 0 ? q(t) && !isNaN(parseInt(e)) ? t.splice(e, 1) : delete t[e] : t[e] = n;
		}
	}
	function si(t, e) {
		typeof e == "string" ? oe(t, e, void 0) : "length" in e && [].map.call(e, function(n) {
			oe(t, n, void 0);
		});
	}
	function Xn(t) {
		var e = {};
		for (var n in t) re(t, n) && (e[n] = t[n]);
		return e;
	}
	var ui = [].concat;
	function Jn(t) {
		return ui.apply([], t);
	}
	var ci = "BigUint64Array,BigInt64Array,Array,Boolean,String,Date,RegExp,Blob,File,FileList,FileSystemFileHandle,FileSystemDirectoryHandle,ArrayBuffer,DataView,Uint8ClampedArray,ImageBitmap,ImageData,Map,Set,CryptoKey".split(",").concat(Jn([
		8,
		16,
		32,
		64
	].map(function(t) {
		return [
			"Int",
			"Uint",
			"Float"
		].map(function(e) {
			return e + t + "Array";
		});
	}))).filter(function(t) {
		return te[t];
	}), Zn = new Set(ci.map(function(t) {
		return te[t];
	}));
	function er(t) {
		var e = {};
		for (var n in t) if (re(t, n)) {
			var r = t[n];
			e[n] = !r || typeof r != "object" || Zn.has(r.constructor) ? r : er(r);
		}
		return e;
	}
	function li(t) {
		for (var e in t) if (re(t, e)) return !1;
		return !0;
	}
	var rt = null;
	function Me(t) {
		rt = /* @__PURE__ */ new WeakMap();
		var e = Xt(t);
		return rt = null, e;
	}
	function Xt(t) {
		if (!t || typeof t != "object") return t;
		var e = rt.get(t);
		if (e) return e;
		if (q(t)) {
			e = [], rt.set(t, e);
			for (var n = 0, r = t.length; n < r; ++n) e.push(Xt(t[n]));
		} else if (Zn.has(t.constructor)) e = t;
		else {
			var i = $e(t);
			e = i === Object.prototype ? {} : Object.create(i), rt.set(t, e);
			for (var o in t) re(t, o) && (e[o] = Xt(t[o]));
		}
		return e;
	}
	var fi = {}.toString;
	function Jt(t) {
		return fi.call(t).slice(8, -1);
	}
	var Zt = typeof Symbol < "u" ? Symbol.iterator : "@@iterator", hi = typeof Zt == "symbol" ? function(t) {
		var e;
		return t != null && (e = t[Zt]) && e.apply(t);
	} : function() {
		return null;
	};
	function Te(t, e) {
		var n = t.indexOf(e);
		return n >= 0 && t.splice(n, 1), n >= 0;
	}
	var Le = {};
	function ve(t) {
		var e, n, r, i;
		if (arguments.length === 1) {
			if (q(t)) return t.slice();
			if (this === Le && typeof t == "string") return [t];
			if (i = hi(t)) {
				for (n = []; r = i.next(), !r.done;) n.push(r.value);
				return n;
			}
			if (t == null) return [t];
			if (e = t.length, typeof e == "number") {
				for (n = new Array(e); e--;) n[e] = t[e];
				return n;
			}
			return [t];
		}
		for (e = arguments.length, n = new Array(e); e--;) n[e] = arguments[e];
		return n;
	}
	var en = typeof Symbol < "u" ? function(t) {
		return t[Symbol.toStringTag] === "AsyncFunction";
	} : function() {
		return !1;
	}, di = [
		"Modify",
		"Bulk",
		"OpenFailed",
		"VersionChange",
		"Schema",
		"Upgrade",
		"InvalidTable",
		"MissingAPI",
		"NoSuchDatabase",
		"InvalidArgument",
		"SubTransaction",
		"Unsupported",
		"Internal",
		"DatabaseClosed",
		"PrematureCommit",
		"ForeignAwait"
	], tr = [
		"Unknown",
		"Constraint",
		"Data",
		"TransactionInactive",
		"ReadOnly",
		"Version",
		"NotFound",
		"InvalidState",
		"InvalidAccess",
		"Abort",
		"Timeout",
		"QuotaExceeded",
		"Syntax",
		"DataClone"
	], tn = di.concat(tr), pi = {
		VersionChanged: "Database version changed by other database connection",
		DatabaseClosed: "Database has been closed",
		Abort: "Transaction aborted",
		TransactionInactive: "Transaction has already completed or failed",
		MissingAPI: "IndexedDB API missing. Please visit https://tinyurl.com/y2uuvskb"
	};
	function We(t, e) {
		this.name = t, this.message = e;
	}
	ze(We).from(Error).extend({ toString: function() {
		return this.name + ": " + this.message;
	} });
	function nr(t, e) {
		return t + ". Errors: " + Object.keys(e).map(function(n) {
			return e[n].toString();
		}).filter(function(n, r, i) {
			return i.indexOf(n) === r;
		}).join(`
`);
	}
	function wt(t, e, n, r) {
		this.failures = e, this.failedKeys = r, this.successCount = n, this.message = nr(t, e);
	}
	ze(wt).from(We);
	function Ue(t, e) {
		this.name = "BulkError", this.failures = Object.keys(e).map(function(n) {
			return e[n];
		}), this.failuresByPos = e, this.message = nr(t, this.failures);
	}
	ze(Ue).from(We);
	var nn = tn.reduce(function(t, e) {
		return t[e] = e + "Error", t;
	}, {}), vi = We, K = tn.reduce(function(t, e) {
		var n = e + "Error";
		function r(i, o) {
			this.name = n, i ? typeof i == "string" ? (this.message = "".concat(i).concat(o ? `
 ` + o : ""), this.inner = o || null) : typeof i == "object" && (this.message = "".concat(i.name, " ").concat(i.message), this.inner = i) : (this.message = pi[e] || n, this.inner = null);
		}
		return ze(r).from(vi), t[e] = r, t;
	}, {});
	K.Syntax = SyntaxError, K.Type = TypeError, K.Range = RangeError;
	var rr = tr.reduce(function(t, e) {
		return t[e + "Error"] = K[e], t;
	}, {});
	function mi(t, e) {
		if (!t || t instanceof We || t instanceof TypeError || t instanceof SyntaxError || !t.name || !rr[t.name]) return t;
		var n = new rr[t.name](e || t.message, t);
		return "stack" in t && ge(n, "stack", { get: function() {
			return this.inner.stack;
		} }), n;
	}
	var bt = tn.reduce(function(t, e) {
		return [
			"Syntax",
			"Type",
			"Range"
		].indexOf(e) === -1 && (t[e + "Error"] = K[e]), t;
	}, {});
	bt.ModifyError = wt, bt.DexieError = We, bt.BulkError = Ue;
	function W() {}
	function it(t) {
		return t;
	}
	function yi(t, e) {
		return t == null || t === it ? e : function(n) {
			return e(t(n));
		};
	}
	function Ce(t, e) {
		return function() {
			t.apply(this, arguments), e.apply(this, arguments);
		};
	}
	function gi(t, e) {
		return t === W ? e : function() {
			var n = t.apply(this, arguments);
			n !== void 0 && (arguments[0] = n);
			var r = this.onsuccess, i = this.onerror;
			this.onsuccess = null, this.onerror = null;
			var o = e.apply(this, arguments);
			return r && (this.onsuccess = this.onsuccess ? Ce(r, this.onsuccess) : r), i && (this.onerror = this.onerror ? Ce(i, this.onerror) : i), o !== void 0 ? o : n;
		};
	}
	function wi(t, e) {
		return t === W ? e : function() {
			t.apply(this, arguments);
			var n = this.onsuccess, r = this.onerror;
			this.onsuccess = this.onerror = null, e.apply(this, arguments), n && (this.onsuccess = this.onsuccess ? Ce(n, this.onsuccess) : n), r && (this.onerror = this.onerror ? Ce(r, this.onerror) : r);
		};
	}
	function bi(t, e) {
		return t === W ? e : function(n) {
			var r = t.apply(this, arguments);
			ie(n, r);
			var i = this.onsuccess, o = this.onerror;
			this.onsuccess = null, this.onerror = null;
			var a = e.apply(this, arguments);
			return i && (this.onsuccess = this.onsuccess ? Ce(i, this.onsuccess) : i), o && (this.onerror = this.onerror ? Ce(o, this.onerror) : o), r === void 0 ? a === void 0 ? void 0 : a : ie(r, a);
		};
	}
	function _i(t, e) {
		return t === W ? e : function() {
			return e.apply(this, arguments) === !1 ? !1 : t.apply(this, arguments);
		};
	}
	function rn(t, e) {
		return t === W ? e : function() {
			var n = t.apply(this, arguments);
			if (n && typeof n.then == "function") {
				for (var r = this, i = arguments.length, o = new Array(i); i--;) o[i] = arguments[i];
				return n.then(function() {
					return e.apply(r, o);
				});
			}
			return e.apply(this, arguments);
		};
	}
	var fe = typeof location < "u" && /^(http|https):\/\/(localhost|127\.0\.0\.1)/.test(location.href);
	function ir(t, e) {
		fe = t;
	}
	var ot = {}, or = 100, on = typeof Promise > "u" ? [] : (function() {
		var t = Promise.resolve();
		if (typeof crypto > "u" || !crypto.subtle) return [
			t,
			$e(t),
			t
		];
		var e = crypto.subtle.digest("SHA-512", new Uint8Array([0]));
		return [
			e,
			$e(e),
			t
		];
	})(), ar = on[0], sr = on[1], Si = on[2], Ii = sr && sr.then, Oe = ar && ar.constructor, an = !!Si;
	function ki() {
		queueMicrotask(Ai);
	}
	var at = function(t, e) {
		st.push([t, e]), _t && (ki(), _t = !1);
	}, sn = !0, _t = !0, Pe = [], St = [], un = it, we = {
		id: "global",
		global: !0,
		ref: 0,
		unhandleds: [],
		onunhandled: W,
		pgp: !1,
		env: {},
		finalize: W
	}, B = we, st = [], Re = 0, It = [];
	function P(t) {
		if (typeof this != "object") throw new TypeError("Promises must be constructed via new");
		this._listeners = [], this._lib = !1;
		var e = this._PSD = B;
		if (typeof t != "function") {
			if (t !== ot) throw new TypeError("Not a function");
			this._state = arguments[1], this._value = arguments[2], this._state === !1 && ln(this, this._value);
			return;
		}
		this._state = null, this._value = null, ++e.ref, cr(this, t);
	}
	var cn = {
		get: function() {
			var t = B, e = Et;
			function n(r, i) {
				var o = this, a = !t.global && (t !== B || e !== Et), u = a && !_e(), s = new P(function(c, l) {
					fn(o, new ur(hr(r, t, a, u), hr(i, t, a, u), c, l, t));
				});
				return this._consoleTask && (s._consoleTask = this._consoleTask), s;
			}
			return n.prototype = ot, n;
		},
		set: function(t) {
			ge(this, "then", t && t.prototype === ot ? cn : {
				get: function() {
					return t;
				},
				set: cn.set
			});
		}
	};
	je(P.prototype, {
		then: cn,
		_then: function(t, e) {
			fn(this, new ur(null, null, t, e, B));
		},
		catch: function(t) {
			if (arguments.length === 1) return this.then(null, t);
			var e = arguments[0], n = arguments[1];
			return typeof e == "function" ? this.then(null, function(r) {
				return r instanceof e ? n(r) : kt(r);
			}) : this.then(null, function(r) {
				return r && r.name === e ? n(r) : kt(r);
			});
		},
		finally: function(t) {
			return this.then(function(e) {
				return P.resolve(t()).then(function() {
					return e;
				});
			}, function(e) {
				return P.resolve(t()).then(function() {
					return kt(e);
				});
			});
		},
		timeout: function(t, e) {
			var n = this;
			return t < 1 / 0 ? new P(function(r, i) {
				var o = setTimeout(function() {
					return i(new K.Timeout(e));
				}, t);
				n.then(r, i).finally(clearTimeout.bind(null, o));
			}) : this;
		}
	}), typeof Symbol < "u" && Symbol.toStringTag && ge(P.prototype, Symbol.toStringTag, "Dexie.Promise"), we.env = fr();
	function ur(t, e, n, r, i) {
		this.onFulfilled = typeof t == "function" ? t : null, this.onRejected = typeof e == "function" ? e : null, this.resolve = n, this.reject = r, this.psd = i;
	}
	je(P, {
		all: function() {
			var t = ve.apply(null, arguments).map(Mt);
			return new P(function(e, n) {
				t.length === 0 && e([]);
				var r = t.length;
				t.forEach(function(i, o) {
					return P.resolve(i).then(function(a) {
						t[o] = a, --r || e(t);
					}, n);
				});
			});
		},
		resolve: function(t) {
			return t instanceof P ? t : t && typeof t.then == "function" ? new P(function(e, n) {
				t.then(e, n);
			}) : new P(ot, !0, t);
		},
		reject: kt,
		race: function() {
			var t = ve.apply(null, arguments).map(Mt);
			return new P(function(e, n) {
				t.map(function(r) {
					return P.resolve(r).then(e, n);
				});
			});
		},
		PSD: {
			get: function() {
				return B;
			},
			set: function(t) {
				return B = t;
			}
		},
		totalEchoes: { get: function() {
			return Et;
		} },
		newPSD: be,
		usePSD: Be,
		scheduler: {
			get: function() {
				return at;
			},
			set: function(t) {
				at = t;
			}
		},
		rejectionMapper: {
			get: function() {
				return un;
			},
			set: function(t) {
				un = t;
			}
		},
		follow: function(t, e) {
			return new P(function(n, r) {
				return be(function(i, o) {
					var a = B;
					a.unhandleds = [], a.onunhandled = o, a.finalize = Ce(function() {
						var u = this;
						Ei(function() {
							u.unhandleds.length === 0 ? i() : o(u.unhandleds[0]);
						});
					}, a.finalize), t();
				}, e, n, r);
			});
		}
	}), Oe && (Oe.allSettled && ge(P, "allSettled", function() {
		var t = ve.apply(null, arguments).map(Mt);
		return new P(function(e) {
			t.length === 0 && e([]);
			var n = t.length, r = new Array(n);
			t.forEach(function(i, o) {
				return P.resolve(i).then(function(a) {
					return r[o] = {
						status: "fulfilled",
						value: a
					};
				}, function(a) {
					return r[o] = {
						status: "rejected",
						reason: a
					};
				}).then(function() {
					return --n || e(r);
				});
			});
		});
	}), Oe.any && typeof AggregateError < "u" && ge(P, "any", function() {
		var t = ve.apply(null, arguments).map(Mt);
		return new P(function(e, n) {
			t.length === 0 && n(/* @__PURE__ */ new AggregateError([]));
			var r = t.length, i = new Array(r);
			t.forEach(function(o, a) {
				return P.resolve(o).then(function(u) {
					return e(u);
				}, function(u) {
					i[a] = u, --r || n(new AggregateError(i));
				});
			});
		});
	}), Oe.withResolvers && (P.withResolvers = Oe.withResolvers));
	function cr(t, e) {
		try {
			e(function(n) {
				if (t._state === null) {
					if (n === t) throw new TypeError("A promise cannot be resolved with itself.");
					var r = t._lib && He();
					n && typeof n.then == "function" ? cr(t, function(i, o) {
						n instanceof P ? n._then(i, o) : n.then(i, o);
					}) : (t._state = !0, t._value = n, lr(t)), r && qe();
				}
			}, ln.bind(null, t));
		} catch (n) {
			ln(t, n);
		}
	}
	function ln(t, e) {
		if (St.push(e), t._state === null) {
			var n = t._lib && He();
			e = un(e), t._state = !1, t._value = e, Mi(t), lr(t), n && qe();
		}
	}
	function lr(t) {
		var e = t._listeners;
		t._listeners = [];
		for (var n = 0, r = e.length; n < r; ++n) fn(t, e[n]);
		var i = t._PSD;
		--i.ref || i.finalize(), Re === 0 && (++Re, at(function() {
			--Re === 0 && hn();
		}, []));
	}
	function fn(t, e) {
		if (t._state === null) {
			t._listeners.push(e);
			return;
		}
		var n = t._state ? e.onFulfilled : e.onRejected;
		if (n === null) return (t._state ? e.resolve : e.reject)(t._value);
		++e.psd.ref, ++Re, at(xi, [
			n,
			t,
			e
		]);
	}
	function xi(t, e, n) {
		try {
			var r, i = e._value;
			!e._state && St.length && (St = []), r = fe && e._consoleTask ? e._consoleTask.run(function() {
				return t(i);
			}) : t(i), !e._state && St.indexOf(i) === -1 && Ti(e), n.resolve(r);
		} catch (o) {
			n.reject(o);
		} finally {
			--Re === 0 && hn(), --n.psd.ref || n.psd.finalize();
		}
	}
	function Ai() {
		Be(we, function() {
			He() && qe();
		});
	}
	function He() {
		var t = sn;
		return sn = !1, _t = !1, t;
	}
	function qe() {
		var t, e, n;
		do
			for (; st.length > 0;) for (t = st, st = [], n = t.length, e = 0; e < n; ++e) {
				var r = t[e];
				r[0].apply(null, r[1]);
			}
		while (st.length > 0);
		sn = !0, _t = !0;
	}
	function hn() {
		var t = Pe;
		Pe = [], t.forEach(function(r) {
			r._PSD.onunhandled.call(null, r._value, r);
		});
		for (var e = It.slice(0), n = e.length; n;) e[--n]();
	}
	function Ei(t) {
		function e() {
			t(), It.splice(It.indexOf(e), 1);
		}
		It.push(e), ++Re, at(function() {
			--Re === 0 && hn();
		}, []);
	}
	function Mi(t) {
		Pe.some(function(e) {
			return e._value === t._value;
		}) || Pe.push(t);
	}
	function Ti(t) {
		for (var e = Pe.length; e;) if (Pe[--e]._value === t._value) {
			Pe.splice(e, 1);
			return;
		}
	}
	function kt(t) {
		return new P(ot, !1, t);
	}
	function H(t, e) {
		var n = B;
		return function() {
			var r = He(), i = B;
			try {
				return Se(n, !0), t.apply(this, arguments);
			} catch (o) {
				e && e(o);
			} finally {
				Se(i, !1), r && qe();
			}
		};
	}
	var Z = {
		awaits: 0,
		echoes: 0,
		id: 0
	}, Ci = 0, xt = [], At = 0, Et = 0, Oi = 0;
	function be(t, e, n, r) {
		var i = B, o = Object.create(i);
		o.parent = i, o.ref = 0, o.global = !1, o.id = ++Oi, we.env, o.env = an ? {
			Promise: P,
			PromiseProp: {
				value: P,
				configurable: !0,
				writable: !0
			},
			all: P.all,
			race: P.race,
			allSettled: P.allSettled,
			any: P.any,
			resolve: P.resolve,
			reject: P.reject
		} : {}, e && ie(o, e), ++i.ref, o.finalize = function() {
			--this.parent.ref || this.parent.finalize();
		};
		var a = Be(o, t, n, r);
		return o.ref === 0 && o.finalize(), a;
	}
	function Ge() {
		return Z.id || (Z.id = ++Ci), ++Z.awaits, Z.echoes += or, Z.id;
	}
	function _e() {
		return Z.awaits ? (--Z.awaits === 0 && (Z.id = 0), Z.echoes = Z.awaits * or, !0) : !1;
	}
	("" + Ii).indexOf("[native code]") === -1 && (Ge = _e = W);
	function Mt(t) {
		return Z.echoes && t && t.constructor === Oe ? (Ge(), t.then(function(e) {
			return _e(), e;
		}, function(e) {
			return _e(), G(e);
		})) : t;
	}
	function Pi(t) {
		++Et, (!Z.echoes || --Z.echoes === 0) && (Z.echoes = Z.awaits = Z.id = 0), xt.push(B), Se(t, !0);
	}
	function Ri() {
		var t = xt[xt.length - 1];
		xt.pop(), Se(t, !1);
	}
	function Se(t, e) {
		var n = B;
		if ((e ? Z.echoes && (!At++ || t !== B) : At && (!--At || t !== B)) && queueMicrotask(e ? Pi.bind(null, t) : Ri), t !== B && (B = t, n === we && (we.env = fr()), an)) {
			var r = we.env.Promise, i = t.env;
			(n.global || t.global) && (Object.defineProperty(te, "Promise", i.PromiseProp), r.all = i.all, r.race = i.race, r.resolve = i.resolve, r.reject = i.reject, i.allSettled && (r.allSettled = i.allSettled), i.any && (r.any = i.any));
		}
	}
	function fr() {
		var t = te.Promise;
		return an ? {
			Promise: t,
			PromiseProp: Object.getOwnPropertyDescriptor(te, "Promise"),
			all: t.all,
			race: t.race,
			allSettled: t.allSettled,
			any: t.any,
			resolve: t.resolve,
			reject: t.reject
		} : {};
	}
	function Be(t, e, n, r, i) {
		var o = B;
		try {
			return Se(t, !0), e(n, r, i);
		} finally {
			Se(o, !1);
		}
	}
	function hr(t, e, n, r) {
		return typeof t != "function" ? t : function() {
			var i = B;
			n && Ge(), Se(e, !0);
			try {
				return t.apply(this, arguments);
			} finally {
				Se(i, !1), r && queueMicrotask(_e);
			}
		};
	}
	function dn(t) {
		Promise === Oe && Z.echoes === 0 ? At === 0 ? t() : enqueueNativeMicroTask(t) : setTimeout(t, 0);
	}
	var G = P.reject;
	function pn(t, e, n, r) {
		if (!t.idbdb || !t._state.openComplete && !B.letThrough && !t._vip) {
			if (t._state.openComplete) return G(new K.DatabaseClosed(t._state.dbOpenError));
			if (!t._state.isBeingOpened) {
				if (!t._state.autoOpen) return G(new K.DatabaseClosed());
				t.open().catch(W);
			}
			return t._state.dbReadyPromise.then(function() {
				return pn(t, e, n, r);
			});
		} else {
			var i = t._createTransaction(e, n, t._dbSchema);
			try {
				i.create(), t._state.PR1398_maxLoop = 3;
			} catch (o) {
				return o.name === nn.InvalidState && t.isOpen() && --t._state.PR1398_maxLoop > 0 ? (console.warn("Dexie: Need to reopen db"), t.close({ disableAutoOpen: !1 }), t.open().then(function() {
					return pn(t, e, n, r);
				})) : G(o);
			}
			return i._promise(e, function(o, a) {
				return be(function() {
					return B.trans = i, r(o, a, i);
				});
			}).then(function(o) {
				if (e === "readwrite") try {
					i.idbtrans.commit();
				} catch {}
				return e === "readonly" ? o : i._completion.then(function() {
					return o;
				});
			});
		}
	}
	var dr = "4.0.10", Fe = "￿", vn = -1 / 0, me = "Invalid key provided. Keys must be of type string, number, Date or Array<string | number | Date>.", pr = "String expected.", Ye = [], Tt = "__dbnames", mn = "readonly", yn = "readwrite";
	function Ke(t, e) {
		return t ? e ? function() {
			return t.apply(this, arguments) && e.apply(this, arguments);
		} : t : e;
	}
	var vr = {
		type: 3,
		lower: -1 / 0,
		lowerOpen: !1,
		upper: [[]],
		upperOpen: !1
	};
	function Ct(t) {
		return typeof t == "string" && !/\./.test(t) ? function(e) {
			return e[t] === void 0 && t in e && (e = Me(e), delete e[t]), e;
		} : function(e) {
			return e;
		};
	}
	function Bi() {
		throw K.Type();
	}
	function L(t, e) {
		try {
			var n = mr(t), r = mr(e);
			if (n !== r) return n === "Array" ? 1 : r === "Array" ? -1 : n === "binary" ? 1 : r === "binary" ? -1 : n === "string" ? 1 : r === "string" ? -1 : n === "Date" ? 1 : r !== "Date" ? NaN : -1;
			switch (n) {
				case "number":
				case "Date":
				case "string": return t > e ? 1 : t < e ? -1 : 0;
				case "binary": return Ki(yr(t), yr(e));
				case "Array": return Fi(t, e);
			}
		} catch {}
		return NaN;
	}
	function Fi(t, e) {
		for (var n = t.length, r = e.length, i = n < r ? n : r, o = 0; o < i; ++o) {
			var a = L(t[o], e[o]);
			if (a !== 0) return a;
		}
		return n === r ? 0 : n < r ? -1 : 1;
	}
	function Ki(t, e) {
		for (var n = t.length, r = e.length, i = n < r ? n : r, o = 0; o < i; ++o) if (t[o] !== e[o]) return t[o] < e[o] ? -1 : 1;
		return n === r ? 0 : n < r ? -1 : 1;
	}
	function mr(t) {
		var e = typeof t;
		if (e !== "object") return e;
		if (ArrayBuffer.isView(t)) return "binary";
		var n = Jt(t);
		return n === "ArrayBuffer" ? "binary" : n;
	}
	function yr(t) {
		return t instanceof Uint8Array ? t : ArrayBuffer.isView(t) ? new Uint8Array(t.buffer, t.byteOffset, t.byteLength) : new Uint8Array(t);
	}
	var gr = (function() {
		function t() {}
		return t.prototype._trans = function(e, n, r) {
			var i = this._tx || B.trans, o = this.name, a = fe && typeof console < "u" && console.createTask && console.createTask("Dexie: ".concat(e === "readonly" ? "read" : "write", " ").concat(this.name));
			function u(l, h, p) {
				if (!p.schema[o]) throw new K.NotFound("Table " + o + " not part of transaction");
				return n(p.idbtrans, p);
			}
			var s = He();
			try {
				var c = i && i.db._novip === this.db._novip ? i === B.trans ? i._promise(e, u, r) : be(function() {
					return i._promise(e, u, r);
				}, {
					trans: i,
					transless: B.transless || B
				}) : pn(this.db, e, [this.name], u);
				return a && (c._consoleTask = a, c = c.catch(function(l) {
					return console.trace(l), G(l);
				})), c;
			} finally {
				s && qe();
			}
		}, t.prototype.get = function(e, n) {
			var r = this;
			return e && e.constructor === Object ? this.where(e).first(n) : e == null ? G(new K.Type("Invalid argument to Table.get()")) : this._trans("readonly", function(i) {
				return r.core.get({
					trans: i,
					key: e
				}).then(function(o) {
					return r.hook.reading.fire(o);
				});
			}).then(n);
		}, t.prototype.where = function(e) {
			if (typeof e == "string") return new this.db.WhereClause(this, e);
			if (q(e)) return new this.db.WhereClause(this, "[".concat(e.join("+"), "]"));
			var n = J(e);
			if (n.length === 1) return this.where(n[0]).equals(e[n[0]]);
			var r = this.schema.indexes.concat(this.schema.primKey).filter(function(l) {
				if (l.compound && n.every(function(p) {
					return l.keyPath.indexOf(p) >= 0;
				})) {
					for (var h = 0; h < n.length; ++h) if (n.indexOf(l.keyPath[h]) === -1) return !1;
					return !0;
				}
				return !1;
			}).sort(function(l, h) {
				return l.keyPath.length - h.keyPath.length;
			})[0];
			if (r && this.db._maxKey !== Fe) {
				var i = r.keyPath.slice(0, n.length);
				return this.where(i).equals(i.map(function(l) {
					return e[l];
				}));
			}
			!r && fe && console.warn("The query ".concat(JSON.stringify(e), " on ").concat(this.name, " would benefit from a ") + "compound index [".concat(n.join("+"), "]"));
			var o = this.schema.idxByName;
			function a(l, h) {
				return L(l, h) === 0;
			}
			var u = n.reduce(function(l, h) {
				var p = l[0], b = l[1], f = o[h], d = e[h];
				return [p || f, p || !f ? Ke(b, f && f.multi ? function(g) {
					var I = pe(g, h);
					return q(I) && I.some(function(m) {
						return a(d, m);
					});
				} : function(g) {
					return a(d, pe(g, h));
				}) : b];
			}, [null, null]), s = u[0], c = u[1];
			return s ? this.where(s.name).equals(e[s.keyPath]).filter(c) : r ? this.filter(c) : this.where(n).equals("");
		}, t.prototype.filter = function(e) {
			return this.toCollection().and(e);
		}, t.prototype.count = function(e) {
			return this.toCollection().count(e);
		}, t.prototype.offset = function(e) {
			return this.toCollection().offset(e);
		}, t.prototype.limit = function(e) {
			return this.toCollection().limit(e);
		}, t.prototype.each = function(e) {
			return this.toCollection().each(e);
		}, t.prototype.toArray = function(e) {
			return this.toCollection().toArray(e);
		}, t.prototype.toCollection = function() {
			return new this.db.Collection(new this.db.WhereClause(this));
		}, t.prototype.orderBy = function(e) {
			return new this.db.Collection(new this.db.WhereClause(this, q(e) ? "[".concat(e.join("+"), "]") : e));
		}, t.prototype.reverse = function() {
			return this.toCollection().reverse();
		}, t.prototype.mapToClass = function(e) {
			var n = this, r = n.db, i = n.name;
			this.schema.mappedClass = e, e.prototype instanceof Bi && (e = (function(s) {
				ni(c, s);
				function c() {
					return s !== null && s.apply(this, arguments) || this;
				}
				return Object.defineProperty(c.prototype, "db", {
					get: function() {
						return r;
					},
					enumerable: !1,
					configurable: !0
				}), c.prototype.table = function() {
					return i;
				}, c;
			})(e));
			for (var o = /* @__PURE__ */ new Set(), a = e.prototype; a; a = $e(a)) Object.getOwnPropertyNames(a).forEach(function(s) {
				return o.add(s);
			});
			var u = function(s) {
				if (!s) return s;
				var c = Object.create(e.prototype);
				for (var l in s) if (!o.has(l)) try {
					c[l] = s[l];
				} catch {}
				return c;
			};
			return this.schema.readHook && this.hook.reading.unsubscribe(this.schema.readHook), this.schema.readHook = u, this.hook("reading", u), e;
		}, t.prototype.defineClass = function() {
			function e(n) {
				ie(this, n);
			}
			return this.mapToClass(e);
		}, t.prototype.add = function(e, n) {
			var r = this, i = this.schema.primKey, o = i.auto, a = i.keyPath, u = e;
			return a && o && (u = Ct(a)(e)), this._trans("readwrite", function(s) {
				return r.core.mutate({
					trans: s,
					type: "add",
					keys: n != null ? [n] : null,
					values: [u]
				});
			}).then(function(s) {
				return s.numFailures ? P.reject(s.failures[0]) : s.lastResult;
			}).then(function(s) {
				if (a) try {
					oe(e, a, s);
				} catch {}
				return s;
			});
		}, t.prototype.update = function(e, n) {
			if (typeof e == "object" && !q(e)) {
				var r = pe(e, this.schema.primKey.keyPath);
				return r === void 0 ? G(new K.InvalidArgument("Given object does not contain its primary key")) : this.where(":id").equals(r).modify(n);
			} else return this.where(":id").equals(e).modify(n);
		}, t.prototype.put = function(e, n) {
			var r = this, i = this.schema.primKey, o = i.auto, a = i.keyPath, u = e;
			return a && o && (u = Ct(a)(e)), this._trans("readwrite", function(s) {
				return r.core.mutate({
					trans: s,
					type: "put",
					values: [u],
					keys: n != null ? [n] : null
				});
			}).then(function(s) {
				return s.numFailures ? P.reject(s.failures[0]) : s.lastResult;
			}).then(function(s) {
				if (a) try {
					oe(e, a, s);
				} catch {}
				return s;
			});
		}, t.prototype.delete = function(e) {
			var n = this;
			return this._trans("readwrite", function(r) {
				return n.core.mutate({
					trans: r,
					type: "delete",
					keys: [e]
				});
			}).then(function(r) {
				return r.numFailures ? P.reject(r.failures[0]) : void 0;
			});
		}, t.prototype.clear = function() {
			var e = this;
			return this._trans("readwrite", function(n) {
				return e.core.mutate({
					trans: n,
					type: "deleteRange",
					range: vr
				});
			}).then(function(n) {
				return n.numFailures ? P.reject(n.failures[0]) : void 0;
			});
		}, t.prototype.bulkGet = function(e) {
			var n = this;
			return this._trans("readonly", function(r) {
				return n.core.getMany({
					keys: e,
					trans: r
				}).then(function(i) {
					return i.map(function(o) {
						return n.hook.reading.fire(o);
					});
				});
			});
		}, t.prototype.bulkAdd = function(e, n, r) {
			var i = this, o = Array.isArray(n) ? n : void 0;
			r = r || (o ? void 0 : n);
			var a = r ? r.allKeys : void 0;
			return this._trans("readwrite", function(u) {
				var s = i.schema.primKey, c = s.auto, l = s.keyPath;
				if (l && o) throw new K.InvalidArgument("bulkAdd(): keys argument invalid on tables with inbound keys");
				if (o && o.length !== e.length) throw new K.InvalidArgument("Arguments objects and keys must have the same length");
				var h = e.length, p = l && c ? e.map(Ct(l)) : e;
				return i.core.mutate({
					trans: u,
					type: "add",
					keys: o,
					values: p,
					wantResults: a
				}).then(function(b) {
					var f = b.numFailures, d = b.results, g = b.lastResult, I = b.failures, m = a ? d : g;
					if (f === 0) return m;
					throw new Ue("".concat(i.name, ".bulkAdd(): ").concat(f, " of ").concat(h, " operations failed"), I);
				});
			});
		}, t.prototype.bulkPut = function(e, n, r) {
			var i = this, o = Array.isArray(n) ? n : void 0;
			r = r || (o ? void 0 : n);
			var a = r ? r.allKeys : void 0;
			return this._trans("readwrite", function(u) {
				var s = i.schema.primKey, c = s.auto, l = s.keyPath;
				if (l && o) throw new K.InvalidArgument("bulkPut(): keys argument invalid on tables with inbound keys");
				if (o && o.length !== e.length) throw new K.InvalidArgument("Arguments objects and keys must have the same length");
				var h = e.length, p = l && c ? e.map(Ct(l)) : e;
				return i.core.mutate({
					trans: u,
					type: "put",
					keys: o,
					values: p,
					wantResults: a
				}).then(function(b) {
					var f = b.numFailures, d = b.results, g = b.lastResult, I = b.failures, m = a ? d : g;
					if (f === 0) return m;
					throw new Ue("".concat(i.name, ".bulkPut(): ").concat(f, " of ").concat(h, " operations failed"), I);
				});
			});
		}, t.prototype.bulkUpdate = function(e) {
			var n = this, r = this.core, i = e.map(function(u) {
				return u.key;
			}), o = e.map(function(u) {
				return u.changes;
			}), a = [];
			return this._trans("readwrite", function(u) {
				return r.getMany({
					trans: u,
					keys: i,
					cache: "clone"
				}).then(function(s) {
					var c = [], l = [];
					e.forEach(function(p, b) {
						var f = p.key, d = p.changes, g = s[b];
						if (g) {
							for (var I = 0, m = Object.keys(d); I < m.length; I++) {
								var k = m[I], x = d[k];
								if (k === n.schema.primKey.keyPath) {
									if (L(x, f) !== 0) throw new K.Constraint("Cannot update primary key in bulkUpdate()");
								} else oe(g, k, x);
							}
							a.push(b), c.push(f), l.push(g);
						}
					});
					var h = c.length;
					return r.mutate({
						trans: u,
						type: "put",
						keys: c,
						values: l,
						updates: {
							keys: i,
							changeSpecs: o
						}
					}).then(function(p) {
						var b = p.numFailures, f = p.failures;
						if (b === 0) return h;
						for (var d = 0, g = Object.keys(f); d < g.length; d++) {
							var I = g[d], m = a[Number(I)];
							if (m != null) {
								var k = f[I];
								delete f[I], f[m] = k;
							}
						}
						throw new Ue("".concat(n.name, ".bulkUpdate(): ").concat(b, " of ").concat(h, " operations failed"), f);
					});
				});
			});
		}, t.prototype.bulkDelete = function(e) {
			var n = this, r = e.length;
			return this._trans("readwrite", function(i) {
				return n.core.mutate({
					trans: i,
					type: "delete",
					keys: e
				});
			}).then(function(i) {
				var o = i.numFailures, a = i.lastResult, u = i.failures;
				if (o === 0) return a;
				throw new Ue("".concat(n.name, ".bulkDelete(): ").concat(o, " of ").concat(r, " operations failed"), u);
			});
		}, t;
	})();
	function ut(t) {
		var e = {}, n = function(u, s) {
			if (s) {
				for (var c = arguments.length, l = new Array(c - 1); --c;) l[c - 1] = arguments[c];
				return e[u].subscribe.apply(null, l), t;
			} else if (typeof u == "string") return e[u];
		};
		n.addEventType = o;
		for (var r = 1, i = arguments.length; r < i; ++r) o(arguments[r]);
		return n;
		function o(u, s, c) {
			if (typeof u == "object") return a(u);
			s || (s = _i), c || (c = W);
			var l = {
				subscribers: [],
				fire: c,
				subscribe: function(h) {
					l.subscribers.indexOf(h) === -1 && (l.subscribers.push(h), l.fire = s(l.fire, h));
				},
				unsubscribe: function(h) {
					l.subscribers = l.subscribers.filter(function(p) {
						return p !== h;
					}), l.fire = l.subscribers.reduce(s, c);
				}
			};
			return e[u] = n[u] = l, l;
		}
		function a(u) {
			J(u).forEach(function(s) {
				var c = u[s];
				if (q(c)) o(s, u[s][0], u[s][1]);
				else if (c === "asap") var l = o(s, it, function() {
					for (var p = arguments.length, b = new Array(p); p--;) b[p] = arguments[p];
					l.subscribers.forEach(function(f) {
						Qn(function() {
							f.apply(null, b);
						});
					});
				});
				else throw new K.InvalidArgument("Invalid event config");
			});
		}
	}
	function ct(t, e) {
		return ze(e).from({ prototype: t }), e;
	}
	function Di(t) {
		return ct(gr.prototype, function(n, r, i) {
			this.db = t, this._tx = i, this.name = n, this.schema = r, this.hook = t._allTables[n] ? t._allTables[n].hook : ut(null, {
				creating: [gi, W],
				reading: [yi, it],
				updating: [bi, W],
				deleting: [wi, W]
			});
		});
	}
	function Qe(t, e) {
		return !(t.filter || t.algorithm || t.or) && (e ? t.justLimit : !t.replayFilter);
	}
	function gn(t, e) {
		t.filter = Ke(t.filter, e);
	}
	function wn(t, e, n) {
		var r = t.replayFilter;
		t.replayFilter = r ? function() {
			return Ke(r(), e());
		} : e, t.justLimit = n && !r;
	}
	function Vi(t, e) {
		t.isMatch = Ke(t.isMatch, e);
	}
	function Ot(t, e) {
		if (t.isPrimKey) return e.primaryKey;
		var n = e.getIndexByKeyPath(t.index);
		if (!n) throw new K.Schema("KeyPath " + t.index + " on object store " + e.name + " is not indexed");
		return n;
	}
	function wr(t, e, n) {
		var r = Ot(t, e.schema);
		return e.openCursor({
			trans: n,
			values: !t.keysOnly,
			reverse: t.dir === "prev",
			unique: !!t.unique,
			query: {
				index: r,
				range: t.range
			}
		});
	}
	function Pt(t, e, n, r) {
		var i = t.replayFilter ? Ke(t.filter, t.replayFilter()) : t.filter;
		if (t.or) {
			var o = {}, a = function(u, s, c) {
				if (!i || i(s, c, function(p) {
					return s.stop(p);
				}, function(p) {
					return s.fail(p);
				})) {
					var l = s.primaryKey, h = "" + l;
					h === "[object ArrayBuffer]" && (h = "" + new Uint8Array(l)), re(o, h) || (o[h] = !0, e(u, s, c));
				}
			};
			return Promise.all([t.or._iterate(a, n), br(wr(t, r, n), t.algorithm, a, !t.keysOnly && t.valueMapper)]);
		} else return br(wr(t, r, n), Ke(t.algorithm, i), e, !t.keysOnly && t.valueMapper);
	}
	function br(t, e, n, r) {
		var i = H(r ? function(o, a, u) {
			return n(r(o), a, u);
		} : n);
		return t.then(function(o) {
			if (o) return o.start(function() {
				var a = function() {
					return o.continue();
				};
				(!e || e(o, function(u) {
					return a = u;
				}, function(u) {
					o.stop(u), a = W;
				}, function(u) {
					o.fail(u), a = W;
				})) && i(o.value, o, function(u) {
					return a = u;
				}), a();
			});
		});
	}
	var Ni = (function() {
		function t(e) {
			Object.assign(this, e);
		}
		return t.prototype.execute = function(e) {
			var n;
			if (this.add !== void 0) {
				var r = this.add;
				if (q(r)) return yt(yt([], q(e) ? e : [], !0), r, !0).sort();
				if (typeof r == "number") return (Number(e) || 0) + r;
				if (typeof r == "bigint") try {
					return BigInt(e) + r;
				} catch {
					return BigInt(0) + r;
				}
				throw new TypeError("Invalid term ".concat(r));
			}
			if (this.remove !== void 0) {
				var i = this.remove;
				if (q(i)) return q(e) ? e.filter(function(a) {
					return !i.includes(a);
				}).sort() : [];
				if (typeof i == "number") return Number(e) - i;
				if (typeof i == "bigint") try {
					return BigInt(e) - i;
				} catch {
					return BigInt(0) - i;
				}
				throw new TypeError("Invalid subtrahend ".concat(i));
			}
			var o = (n = this.replacePrefix) === null || n === void 0 ? void 0 : n[0];
			return o && typeof e == "string" && e.startsWith(o) ? this.replacePrefix[1] + e.substring(o.length) : e;
		}, t;
	})(), $i = (function() {
		function t() {}
		return t.prototype._read = function(e, n) {
			var r = this._ctx;
			return r.error ? r.table._trans(null, G.bind(null, r.error)) : r.table._trans("readonly", e).then(n);
		}, t.prototype._write = function(e) {
			var n = this._ctx;
			return n.error ? n.table._trans(null, G.bind(null, n.error)) : n.table._trans("readwrite", e, "locked");
		}, t.prototype._addAlgorithm = function(e) {
			var n = this._ctx;
			n.algorithm = Ke(n.algorithm, e);
		}, t.prototype._iterate = function(e, n) {
			return Pt(this._ctx, e, n, this._ctx.table.core);
		}, t.prototype.clone = function(e) {
			var n = Object.create(this.constructor.prototype), r = Object.create(this._ctx);
			return e && ie(r, e), n._ctx = r, n;
		}, t.prototype.raw = function() {
			return this._ctx.valueMapper = null, this;
		}, t.prototype.each = function(e) {
			var n = this._ctx;
			return this._read(function(r) {
				return Pt(n, e, r, n.table.core);
			});
		}, t.prototype.count = function(e) {
			var n = this;
			return this._read(function(r) {
				var i = n._ctx, o = i.table.core;
				if (Qe(i, !0)) return o.count({
					trans: r,
					query: {
						index: Ot(i, o.schema),
						range: i.range
					}
				}).then(function(u) {
					return Math.min(u, i.limit);
				});
				var a = 0;
				return Pt(i, function() {
					return ++a, !1;
				}, r, o).then(function() {
					return a;
				});
			}).then(e);
		}, t.prototype.sortBy = function(e, n) {
			var r = e.split(".").reverse(), i = r[0], o = r.length - 1;
			function a(c, l) {
				return l ? a(c[r[l]], l - 1) : c[i];
			}
			var u = this._ctx.dir === "next" ? 1 : -1;
			function s(c, l) {
				return L(a(c, o), a(l, o)) * u;
			}
			return this.toArray(function(c) {
				return c.sort(s);
			}).then(n);
		}, t.prototype.toArray = function(e) {
			var n = this;
			return this._read(function(r) {
				var i = n._ctx;
				if (i.dir === "next" && Qe(i, !0) && i.limit > 0) {
					var o = i.valueMapper, a = Ot(i, i.table.core.schema);
					return i.table.core.query({
						trans: r,
						limit: i.limit,
						values: !0,
						query: {
							index: a,
							range: i.range
						}
					}).then(function(s) {
						var c = s.result;
						return o ? c.map(o) : c;
					});
				} else {
					var u = [];
					return Pt(i, function(s) {
						return u.push(s);
					}, r, i.table.core).then(function() {
						return u;
					});
				}
			}, e);
		}, t.prototype.offset = function(e) {
			var n = this._ctx;
			return e <= 0 ? this : (n.offset += e, Qe(n) ? wn(n, function() {
				var r = e;
				return function(i, o) {
					return r === 0 ? !0 : r === 1 ? (--r, !1) : (o(function() {
						i.advance(r), r = 0;
					}), !1);
				};
			}) : wn(n, function() {
				var r = e;
				return function() {
					return --r < 0;
				};
			}), this);
		}, t.prototype.limit = function(e) {
			return this._ctx.limit = Math.min(this._ctx.limit, e), wn(this._ctx, function() {
				var n = e;
				return function(r, i, o) {
					return --n <= 0 && i(o), n >= 0;
				};
			}, !0), this;
		}, t.prototype.until = function(e, n) {
			return gn(this._ctx, function(r, i, o) {
				return e(r.value) ? (i(o), n) : !0;
			}), this;
		}, t.prototype.first = function(e) {
			return this.limit(1).toArray(function(n) {
				return n[0];
			}).then(e);
		}, t.prototype.last = function(e) {
			return this.reverse().first(e);
		}, t.prototype.filter = function(e) {
			return gn(this._ctx, function(n) {
				return e(n.value);
			}), Vi(this._ctx, e), this;
		}, t.prototype.and = function(e) {
			return this.filter(e);
		}, t.prototype.or = function(e) {
			return new this.db.WhereClause(this._ctx.table, e, this);
		}, t.prototype.reverse = function() {
			return this._ctx.dir = this._ctx.dir === "prev" ? "next" : "prev", this._ondirectionchange && this._ondirectionchange(this._ctx.dir), this;
		}, t.prototype.desc = function() {
			return this.reverse();
		}, t.prototype.eachKey = function(e) {
			var n = this._ctx;
			return n.keysOnly = !n.isMatch, this.each(function(r, i) {
				e(i.key, i);
			});
		}, t.prototype.eachUniqueKey = function(e) {
			return this._ctx.unique = "unique", this.eachKey(e);
		}, t.prototype.eachPrimaryKey = function(e) {
			var n = this._ctx;
			return n.keysOnly = !n.isMatch, this.each(function(r, i) {
				e(i.primaryKey, i);
			});
		}, t.prototype.keys = function(e) {
			var n = this._ctx;
			n.keysOnly = !n.isMatch;
			var r = [];
			return this.each(function(i, o) {
				r.push(o.key);
			}).then(function() {
				return r;
			}).then(e);
		}, t.prototype.primaryKeys = function(e) {
			var n = this._ctx;
			if (n.dir === "next" && Qe(n, !0) && n.limit > 0) return this._read(function(i) {
				var o = Ot(n, n.table.core.schema);
				return n.table.core.query({
					trans: i,
					values: !1,
					limit: n.limit,
					query: {
						index: o,
						range: n.range
					}
				});
			}).then(function(i) {
				return i.result;
			}).then(e);
			n.keysOnly = !n.isMatch;
			var r = [];
			return this.each(function(i, o) {
				r.push(o.primaryKey);
			}).then(function() {
				return r;
			}).then(e);
		}, t.prototype.uniqueKeys = function(e) {
			return this._ctx.unique = "unique", this.keys(e);
		}, t.prototype.firstKey = function(e) {
			return this.limit(1).keys(function(n) {
				return n[0];
			}).then(e);
		}, t.prototype.lastKey = function(e) {
			return this.reverse().firstKey(e);
		}, t.prototype.distinct = function() {
			var e = this._ctx, n = e.index && e.table.schema.idxByName[e.index];
			if (!n || !n.multi) return this;
			var r = {};
			return gn(this._ctx, function(i) {
				var o = i.primaryKey.toString(), a = re(r, o);
				return r[o] = !0, !a;
			}), this;
		}, t.prototype.modify = function(e) {
			var n = this, r = this._ctx;
			return this._write(function(i) {
				var o;
				if (typeof e == "function") o = e;
				else {
					var a = J(e), u = a.length;
					o = function(m) {
						for (var k = !1, x = 0; x < u; ++x) {
							var S = a[x], T = e[S], O = pe(m, S);
							T instanceof Ni ? (oe(m, S, T.execute(O)), k = !0) : O !== T && (oe(m, S, T), k = !0);
						}
						return k;
					};
				}
				var s = r.table.core, c = s.schema.primaryKey, l = c.outbound, h = c.extractKey, p = 200, b = n.db._options.modifyChunkSize;
				b && (typeof b == "object" ? p = b[s.name] || b["*"] || 200 : p = b);
				var f = [], d = 0, g = [], I = function(m, k) {
					var x = k.failures, S = k.numFailures;
					d += m - S;
					for (var T = 0, O = J(x); T < O.length; T++) {
						var y = O[T];
						f.push(x[y]);
					}
				};
				return n.clone().primaryKeys().then(function(m) {
					var k = Qe(r) && r.limit === 1 / 0 && (typeof e != "function" || e === bn) && {
						index: r.index,
						range: r.range
					}, x = function(S) {
						var T = Math.min(p, m.length - S);
						return s.getMany({
							trans: i,
							keys: m.slice(S, S + T),
							cache: "immutable"
						}).then(function(O) {
							for (var y = [], A = [], M = l ? [] : null, E = [], _ = 0; _ < T; ++_) {
								var v = O[_], C = {
									value: Me(v),
									primKey: m[S + _]
								};
								o.call(C, C.value, C) !== !1 && (C.value == null ? E.push(m[S + _]) : !l && L(h(v), h(C.value)) !== 0 ? (E.push(m[S + _]), y.push(C.value)) : (A.push(C.value), l && M.push(m[S + _])));
							}
							return Promise.resolve(y.length > 0 && s.mutate({
								trans: i,
								type: "add",
								values: y
							}).then(function(w) {
								for (var R in w.failures) E.splice(parseInt(R), 1);
								I(y.length, w);
							})).then(function() {
								return (A.length > 0 || k && typeof e == "object") && s.mutate({
									trans: i,
									type: "put",
									keys: M,
									values: A,
									criteria: k,
									changeSpec: typeof e != "function" && e,
									isAdditionalChunk: S > 0
								}).then(function(w) {
									return I(A.length, w);
								});
							}).then(function() {
								return (E.length > 0 || k && e === bn) && s.mutate({
									trans: i,
									type: "delete",
									keys: E,
									criteria: k,
									isAdditionalChunk: S > 0
								}).then(function(w) {
									return I(E.length, w);
								});
							}).then(function() {
								return m.length > S + T && x(S + p);
							});
						});
					};
					return x(0).then(function() {
						if (f.length > 0) throw new wt("Error modifying one or more objects", f, d, g);
						return m.length;
					});
				});
			});
		}, t.prototype.delete = function() {
			var e = this._ctx, n = e.range;
			return Qe(e) && (e.isPrimKey || n.type === 3) ? this._write(function(r) {
				var i = e.table.core.schema.primaryKey, o = n;
				return e.table.core.count({
					trans: r,
					query: {
						index: i,
						range: o
					}
				}).then(function(a) {
					return e.table.core.mutate({
						trans: r,
						type: "deleteRange",
						range: o
					}).then(function(u) {
						var s = u.failures;
						u.lastResult, u.results;
						var c = u.numFailures;
						if (c) throw new wt("Could not delete some values", Object.keys(s).map(function(l) {
							return s[l];
						}), a - c);
						return a - c;
					});
				});
			}) : this.modify(bn);
		}, t;
	})(), bn = function(t, e) {
		return e.value = null;
	};
	function ji(t) {
		return ct($i.prototype, function(n, r) {
			this.db = t;
			var i = vr, o = null;
			if (r) try {
				i = r();
			} catch (c) {
				o = c;
			}
			var a = n._ctx, u = a.table, s = u.hook.reading.fire;
			this._ctx = {
				table: u,
				index: a.index,
				isPrimKey: !a.index || u.schema.primKey.keyPath && a.index === u.schema.primKey.name,
				range: i,
				keysOnly: !1,
				dir: "next",
				unique: "",
				algorithm: null,
				filter: null,
				replayFilter: null,
				justLimit: !0,
				isMatch: null,
				offset: 0,
				limit: 1 / 0,
				error: o,
				or: a.or,
				valueMapper: s !== it ? s : null
			};
		});
	}
	function zi(t, e) {
		return t < e ? -1 : t === e ? 0 : 1;
	}
	function Li(t, e) {
		return t > e ? -1 : t === e ? 0 : 1;
	}
	function ae(t, e, n) {
		var r = t instanceof Sr ? new t.Collection(t) : t;
		return r._ctx.error = n ? new n(e) : new TypeError(e), r;
	}
	function Xe(t) {
		return new t.Collection(t, function() {
			return _r("");
		}).limit(0);
	}
	function Wi(t) {
		return t === "next" ? function(e) {
			return e.toUpperCase();
		} : function(e) {
			return e.toLowerCase();
		};
	}
	function Ui(t) {
		return t === "next" ? function(e) {
			return e.toLowerCase();
		} : function(e) {
			return e.toUpperCase();
		};
	}
	function Hi(t, e, n, r, i, o) {
		for (var a = Math.min(t.length, r.length), u = -1, s = 0; s < a; ++s) {
			var c = e[s];
			if (c !== r[s]) return i(t[s], n[s]) < 0 ? t.substr(0, s) + n[s] + n.substr(s + 1) : i(t[s], r[s]) < 0 ? t.substr(0, s) + r[s] + n.substr(s + 1) : u >= 0 ? t.substr(0, u) + e[u] + n.substr(u + 1) : null;
			i(t[s], c) < 0 && (u = s);
		}
		return a < r.length && o === "next" ? t + n.substr(t.length) : a < t.length && o === "prev" ? t.substr(0, n.length) : u < 0 ? null : t.substr(0, u) + r[u] + n.substr(u + 1);
	}
	function Rt(t, e, n, r) {
		var i, o, a, u, s, c, l, h = n.length;
		if (!n.every(function(d) {
			return typeof d == "string";
		})) return ae(t, pr);
		function p(d) {
			i = Wi(d), o = Ui(d), a = d === "next" ? zi : Li;
			var g = n.map(function(I) {
				return {
					lower: o(I),
					upper: i(I)
				};
			}).sort(function(I, m) {
				return a(I.lower, m.lower);
			});
			u = g.map(function(I) {
				return I.upper;
			}), s = g.map(function(I) {
				return I.lower;
			}), c = d, l = d === "next" ? "" : r;
		}
		p("next");
		var b = new t.Collection(t, function() {
			return Ie(u[0], s[h - 1] + r);
		});
		b._ondirectionchange = function(d) {
			p(d);
		};
		var f = 0;
		return b._addAlgorithm(function(d, g, I) {
			var m = d.key;
			if (typeof m != "string") return !1;
			var k = o(m);
			if (e(k, s, f)) return !0;
			for (var x = null, S = f; S < h; ++S) {
				var T = Hi(m, k, u[S], s[S], a, c);
				T === null && x === null ? f = S + 1 : (x === null || a(x, T) > 0) && (x = T);
			}
			return g(x !== null ? function() {
				d.continue(x + l);
			} : I), !1;
		}), b;
	}
	function Ie(t, e, n, r) {
		return {
			type: 2,
			lower: t,
			upper: e,
			lowerOpen: n,
			upperOpen: r
		};
	}
	function _r(t) {
		return {
			type: 1,
			lower: t,
			upper: t
		};
	}
	var Sr = (function() {
		function t() {}
		return Object.defineProperty(t.prototype, "Collection", {
			get: function() {
				return this._ctx.table.db.Collection;
			},
			enumerable: !1,
			configurable: !0
		}), t.prototype.between = function(e, n, r, i) {
			r = r !== !1, i = i === !0;
			try {
				return this._cmp(e, n) > 0 || this._cmp(e, n) === 0 && (r || i) && !(r && i) ? Xe(this) : new this.Collection(this, function() {
					return Ie(e, n, !r, !i);
				});
			} catch {
				return ae(this, me);
			}
		}, t.prototype.equals = function(e) {
			return e == null ? ae(this, me) : new this.Collection(this, function() {
				return _r(e);
			});
		}, t.prototype.above = function(e) {
			return e == null ? ae(this, me) : new this.Collection(this, function() {
				return Ie(e, void 0, !0);
			});
		}, t.prototype.aboveOrEqual = function(e) {
			return e == null ? ae(this, me) : new this.Collection(this, function() {
				return Ie(e, void 0, !1);
			});
		}, t.prototype.below = function(e) {
			return e == null ? ae(this, me) : new this.Collection(this, function() {
				return Ie(void 0, e, !1, !0);
			});
		}, t.prototype.belowOrEqual = function(e) {
			return e == null ? ae(this, me) : new this.Collection(this, function() {
				return Ie(void 0, e);
			});
		}, t.prototype.startsWith = function(e) {
			return typeof e != "string" ? ae(this, pr) : this.between(e, e + Fe, !0, !0);
		}, t.prototype.startsWithIgnoreCase = function(e) {
			return e === "" ? this.startsWith(e) : Rt(this, function(n, r) {
				return n.indexOf(r[0]) === 0;
			}, [e], Fe);
		}, t.prototype.equalsIgnoreCase = function(e) {
			return Rt(this, function(n, r) {
				return n === r[0];
			}, [e], "");
		}, t.prototype.anyOfIgnoreCase = function() {
			var e = ve.apply(Le, arguments);
			return e.length === 0 ? Xe(this) : Rt(this, function(n, r) {
				return r.indexOf(n) !== -1;
			}, e, "");
		}, t.prototype.startsWithAnyOfIgnoreCase = function() {
			var e = ve.apply(Le, arguments);
			return e.length === 0 ? Xe(this) : Rt(this, function(n, r) {
				return r.some(function(i) {
					return n.indexOf(i) === 0;
				});
			}, e, Fe);
		}, t.prototype.anyOf = function() {
			var e = this, n = ve.apply(Le, arguments), r = this._cmp;
			try {
				n.sort(r);
			} catch {
				return ae(this, me);
			}
			if (n.length === 0) return Xe(this);
			var i = new this.Collection(this, function() {
				return Ie(n[0], n[n.length - 1]);
			});
			i._ondirectionchange = function(a) {
				r = a === "next" ? e._ascending : e._descending, n.sort(r);
			};
			var o = 0;
			return i._addAlgorithm(function(a, u, s) {
				for (var c = a.key; r(c, n[o]) > 0;) if (++o, o === n.length) return u(s), !1;
				return r(c, n[o]) === 0 ? !0 : (u(function() {
					a.continue(n[o]);
				}), !1);
			}), i;
		}, t.prototype.notEqual = function(e) {
			return this.inAnyRange([[vn, e], [e, this.db._maxKey]], {
				includeLowers: !1,
				includeUppers: !1
			});
		}, t.prototype.noneOf = function() {
			var e = ve.apply(Le, arguments);
			if (e.length === 0) return new this.Collection(this);
			try {
				e.sort(this._ascending);
			} catch {
				return ae(this, me);
			}
			var n = e.reduce(function(r, i) {
				return r ? r.concat([[r[r.length - 1][1], i]]) : [[vn, i]];
			}, null);
			return n.push([e[e.length - 1], this.db._maxKey]), this.inAnyRange(n, {
				includeLowers: !1,
				includeUppers: !1
			});
		}, t.prototype.inAnyRange = function(e, n) {
			var r = this, i = this._cmp, o = this._ascending, a = this._descending, u = this._min, s = this._max;
			if (e.length === 0) return Xe(this);
			if (!e.every(function(S) {
				return S[0] !== void 0 && S[1] !== void 0 && o(S[0], S[1]) <= 0;
			})) return ae(this, "First argument to inAnyRange() must be an Array of two-value Arrays [lower,upper] where upper must not be lower than lower", K.InvalidArgument);
			var c = !n || n.includeLowers !== !1, l = n && n.includeUppers === !0;
			function h(S, T) {
				for (var O = 0, y = S.length; O < y; ++O) {
					var A = S[O];
					if (i(T[0], A[1]) < 0 && i(T[1], A[0]) > 0) {
						A[0] = u(A[0], T[0]), A[1] = s(A[1], T[1]);
						break;
					}
				}
				return O === y && S.push(T), S;
			}
			var p = o;
			function b(S, T) {
				return p(S[0], T[0]);
			}
			var f;
			try {
				f = e.reduce(h, []), f.sort(b);
			} catch {
				return ae(this, me);
			}
			var d = 0, g = l ? function(S) {
				return o(S, f[d][1]) > 0;
			} : function(S) {
				return o(S, f[d][1]) >= 0;
			}, I = c ? function(S) {
				return a(S, f[d][0]) > 0;
			} : function(S) {
				return a(S, f[d][0]) >= 0;
			};
			function m(S) {
				return !g(S) && !I(S);
			}
			var k = g, x = new this.Collection(this, function() {
				return Ie(f[0][0], f[f.length - 1][1], !c, !l);
			});
			return x._ondirectionchange = function(S) {
				S === "next" ? (k = g, p = o) : (k = I, p = a), f.sort(b);
			}, x._addAlgorithm(function(S, T, O) {
				for (var y = S.key; k(y);) if (++d, d === f.length) return T(O), !1;
				return m(y) ? !0 : (r._cmp(y, f[d][1]) === 0 || r._cmp(y, f[d][0]) === 0 || T(function() {
					p === o ? S.continue(f[d][0]) : S.continue(f[d][1]);
				}), !1);
			}), x;
		}, t.prototype.startsWithAnyOf = function() {
			var e = ve.apply(Le, arguments);
			return e.every(function(n) {
				return typeof n == "string";
			}) ? e.length === 0 ? Xe(this) : this.inAnyRange(e.map(function(n) {
				return [n, n + Fe];
			})) : ae(this, "startsWithAnyOf() only works with strings");
		}, t;
	})();
	function qi(t) {
		return ct(Sr.prototype, function(n, r, i) {
			if (this.db = t, this._ctx = {
				table: n,
				index: r === ":id" ? null : r,
				or: i
			}, this._cmp = this._ascending = L, this._descending = function(o, a) {
				return L(a, o);
			}, this._max = function(o, a) {
				return L(o, a) > 0 ? o : a;
			}, this._min = function(o, a) {
				return L(o, a) < 0 ? o : a;
			}, this._IDBKeyRange = t._deps.IDBKeyRange, !this._IDBKeyRange) throw new K.MissingAPI();
		});
	}
	function he(t) {
		return H(function(e) {
			return lt(e), t(e.target.error), !1;
		});
	}
	function lt(t) {
		t.stopPropagation && t.stopPropagation(), t.preventDefault && t.preventDefault();
	}
	var ft = "storagemutated", _n = "x-storagemutated-1", ke = ut(null, ft), Gi = (function() {
		function t() {}
		return t.prototype._lock = function() {
			return nt(!B.global), ++this._reculock, this._reculock === 1 && !B.global && (B.lockOwnerFor = this), this;
		}, t.prototype._unlock = function() {
			if (nt(!B.global), --this._reculock === 0) for (B.global || (B.lockOwnerFor = null); this._blockedFuncs.length > 0 && !this._locked();) {
				var e = this._blockedFuncs.shift();
				try {
					Be(e[1], e[0]);
				} catch {}
			}
			return this;
		}, t.prototype._locked = function() {
			return this._reculock && B.lockOwnerFor !== this;
		}, t.prototype.create = function(e) {
			var n = this;
			if (!this.mode) return this;
			var r = this.db.idbdb, i = this.db._state.dbOpenError;
			if (nt(!this.idbtrans), !e && !r) switch (i && i.name) {
				case "DatabaseClosedError": throw new K.DatabaseClosed(i);
				case "MissingAPIError": throw new K.MissingAPI(i.message, i);
				default: throw new K.OpenFailed(i);
			}
			if (!this.active) throw new K.TransactionInactive();
			return nt(this._completion._state === null), e = this.idbtrans = e || (this.db.core ? this.db.core.transaction(this.storeNames, this.mode, { durability: this.chromeTransactionDurability }) : r.transaction(this.storeNames, this.mode, { durability: this.chromeTransactionDurability })), e.onerror = H(function(o) {
				lt(o), n._reject(e.error);
			}), e.onabort = H(function(o) {
				lt(o), n.active && n._reject(new K.Abort(e.error)), n.active = !1, n.on("abort").fire(o);
			}), e.oncomplete = H(function() {
				n.active = !1, n._resolve(), "mutatedParts" in e && ke.storagemutated.fire(e.mutatedParts);
			}), this;
		}, t.prototype._promise = function(e, n, r) {
			var i = this;
			if (e === "readwrite" && this.mode !== "readwrite") return G(new K.ReadOnly("Transaction is readonly"));
			if (!this.active) return G(new K.TransactionInactive());
			if (this._locked()) return new P(function(a, u) {
				i._blockedFuncs.push([function() {
					i._promise(e, n, r).then(a, u);
				}, B]);
			});
			if (r) return be(function() {
				var a = new P(function(u, s) {
					i._lock();
					var c = n(u, s, i);
					c && c.then && c.then(u, s);
				});
				return a.finally(function() {
					return i._unlock();
				}), a._lib = !0, a;
			});
			var o = new P(function(a, u) {
				var s = n(a, u, i);
				s && s.then && s.then(a, u);
			});
			return o._lib = !0, o;
		}, t.prototype._root = function() {
			return this.parent ? this.parent._root() : this;
		}, t.prototype.waitFor = function(e) {
			var n = this._root(), r = P.resolve(e);
			if (n._waitingFor) n._waitingFor = n._waitingFor.then(function() {
				return r;
			});
			else {
				n._waitingFor = r, n._waitingQueue = [];
				var i = n.idbtrans.objectStore(n.storeNames[0]);
				(function a() {
					for (++n._spinCount; n._waitingQueue.length;) n._waitingQueue.shift()();
					n._waitingFor && (i.get(-1 / 0).onsuccess = a);
				})();
			}
			var o = n._waitingFor;
			return new P(function(a, u) {
				r.then(function(s) {
					return n._waitingQueue.push(H(a.bind(null, s)));
				}, function(s) {
					return n._waitingQueue.push(H(u.bind(null, s)));
				}).finally(function() {
					n._waitingFor === o && (n._waitingFor = null);
				});
			});
		}, t.prototype.abort = function() {
			this.active && (this.active = !1, this.idbtrans && this.idbtrans.abort(), this._reject(new K.Abort()));
		}, t.prototype.table = function(e) {
			var n = this._memoizedTables || (this._memoizedTables = {});
			if (re(n, e)) return n[e];
			var r = this.schema[e];
			if (!r) throw new K.NotFound("Table " + e + " not part of transaction");
			var i = new this.db.Table(e, r, this);
			return i.core = this.db.core.table(e), n[e] = i, i;
		}, t;
	})();
	function Yi(t) {
		return ct(Gi.prototype, function(n, r, i, o, a) {
			var u = this;
			this.db = t, this.mode = n, this.storeNames = r, this.schema = i, this.chromeTransactionDurability = o, this.idbtrans = null, this.on = ut(this, "complete", "error", "abort"), this.parent = a || null, this.active = !0, this._reculock = 0, this._blockedFuncs = [], this._resolve = null, this._reject = null, this._waitingFor = null, this._waitingQueue = null, this._spinCount = 0, this._completion = new P(function(s, c) {
				u._resolve = s, u._reject = c;
			}), this._completion.then(function() {
				u.active = !1, u.on.complete.fire();
			}, function(s) {
				var c = u.active;
				return u.active = !1, u.on.error.fire(s), u.parent ? u.parent._reject(s) : c && u.idbtrans && u.idbtrans.abort(), G(s);
			});
		});
	}
	function Sn(t, e, n, r, i, o, a) {
		return {
			name: t,
			keyPath: e,
			unique: n,
			multi: r,
			auto: i,
			compound: o,
			src: (n && !a ? "&" : "") + (r ? "*" : "") + (i ? "++" : "") + Ir(e)
		};
	}
	function Ir(t) {
		return typeof t == "string" ? t : t ? "[" + [].join.call(t, "+") + "]" : "";
	}
	function In(t, e, n) {
		return {
			name: t,
			primKey: e,
			indexes: n,
			mappedClass: null,
			idxByName: ai(n, function(r) {
				return [r.name, r];
			})
		};
	}
	function Qi(t) {
		return t.length === 1 ? t[0] : t;
	}
	var ht = function(t) {
		try {
			return t.only([[]]), ht = function() {
				return [[]];
			}, [[]];
		} catch {
			return ht = function() {
				return Fe;
			}, Fe;
		}
	};
	function kn(t) {
		return t == null ? function() {} : typeof t == "string" ? Xi(t) : function(e) {
			return pe(e, t);
		};
	}
	function Xi(t) {
		return t.split(".").length === 1 ? function(e) {
			return e[t];
		} : function(e) {
			return pe(e, t);
		};
	}
	function kr(t) {
		return [].slice.call(t);
	}
	var Ji = 0;
	function dt(t) {
		return t == null ? ":id" : typeof t == "string" ? t : "[".concat(t.join("+"), "]");
	}
	function Zi(t, e, n) {
		function r(h, p) {
			var b = kr(h.objectStoreNames);
			return {
				schema: {
					name: h.name,
					tables: b.map(function(f) {
						return p.objectStore(f);
					}).map(function(f) {
						var d = f.keyPath, g = f.autoIncrement, I = q(d), m = d == null, k = {}, x = {
							name: f.name,
							primaryKey: {
								name: null,
								isPrimaryKey: !0,
								outbound: m,
								compound: I,
								keyPath: d,
								autoIncrement: g,
								unique: !0,
								extractKey: kn(d)
							},
							indexes: kr(f.indexNames).map(function(S) {
								return f.index(S);
							}).map(function(S) {
								var T = S.name, O = S.unique, y = S.multiEntry, A = S.keyPath, M = {
									name: T,
									compound: q(A),
									keyPath: A,
									unique: O,
									multiEntry: y,
									extractKey: kn(A)
								};
								return k[dt(A)] = M, M;
							}),
							getIndexByKeyPath: function(S) {
								return k[dt(S)];
							}
						};
						return k[":id"] = x.primaryKey, d != null && (k[dt(d)] = x.primaryKey), x;
					})
				},
				hasGetAll: b.length > 0 && "getAll" in p.objectStore(b[0]) && !(typeof navigator < "u" && /Safari/.test(navigator.userAgent) && !/(Chrome\/|Edge\/)/.test(navigator.userAgent) && [].concat(navigator.userAgent.match(/Safari\/(\d*)/))[1] < 604)
			};
		}
		function i(h) {
			if (h.type === 3) return null;
			if (h.type === 4) throw new Error("Cannot convert never type to IDBKeyRange");
			var p = h.lower, b = h.upper, f = h.lowerOpen, d = h.upperOpen;
			return p === void 0 ? b === void 0 ? null : e.upperBound(b, !!d) : b === void 0 ? e.lowerBound(p, !!f) : e.bound(p, b, !!f, !!d);
		}
		function o(h) {
			var p = h.name;
			function b(g) {
				var I = g.trans, m = g.type, k = g.keys, x = g.values, S = g.range;
				return new Promise(function(T, O) {
					T = H(T);
					var y = I.objectStore(p), A = y.keyPath == null, M = m === "put" || m === "add";
					if (!M && m !== "delete" && m !== "deleteRange") throw new Error("Invalid operation type: " + m);
					var E = (k || x || { length: 1 }).length;
					if (k && x && k.length !== x.length) throw new Error("Given keys array must have same length as given values array.");
					if (E === 0) return T({
						numFailures: 0,
						failures: {},
						results: [],
						lastResult: void 0
					});
					var _, v = [], C = [], w = 0, R = function(U) {
						++w, lt(U);
					};
					if (m === "deleteRange") {
						if (S.type === 4) return T({
							numFailures: w,
							failures: C,
							results: [],
							lastResult: void 0
						});
						S.type === 3 ? v.push(_ = y.clear()) : v.push(_ = y.delete(i(S)));
					} else {
						var F = M ? A ? [x, k] : [x, null] : [k, null], N = F[0], $ = F[1];
						if (M) for (var z = 0; z < E; ++z) v.push(_ = $ && $[z] !== void 0 ? y[m](N[z], $[z]) : y[m](N[z])), _.onerror = R;
						else for (var z = 0; z < E; ++z) v.push(_ = y[m](N[z])), _.onerror = R;
					}
					var D = function(U) {
						var Y = U.target.result;
						v.forEach(function(j, ue) {
							return j.error != null && (C[ue] = j.error);
						}), T({
							numFailures: w,
							failures: C,
							results: m === "delete" ? k : v.map(function(j) {
								return j.result;
							}),
							lastResult: Y
						});
					};
					_.onerror = function(U) {
						R(U), D(U);
					}, _.onsuccess = D;
				});
			}
			function f(g) {
				var I = g.trans, m = g.values, k = g.query, x = g.reverse, S = g.unique;
				return new Promise(function(T, O) {
					T = H(T);
					var y = k.index, A = k.range, M = I.objectStore(p), E = y.isPrimaryKey ? M : M.index(y.name), _ = x ? S ? "prevunique" : "prev" : S ? "nextunique" : "next", v = m || !("openKeyCursor" in E) ? E.openCursor(i(A), _) : E.openKeyCursor(i(A), _);
					v.onerror = he(O), v.onsuccess = H(function(C) {
						var w = v.result;
						if (!w) {
							T(null);
							return;
						}
						w.___id = ++Ji, w.done = !1;
						var R = w.continue.bind(w), F = w.continuePrimaryKey;
						F && (F = F.bind(w));
						var N = w.advance.bind(w), $ = function() {
							throw new Error("Cursor not started");
						}, z = function() {
							throw new Error("Cursor not stopped");
						};
						w.trans = I, w.stop = w.continue = w.continuePrimaryKey = w.advance = $, w.fail = H(O), w.next = function() {
							var D = this, U = 1;
							return this.start(function() {
								return U-- ? D.continue() : D.stop();
							}).then(function() {
								return D;
							});
						}, w.start = function(D) {
							var U = new Promise(function(j, ue) {
								j = H(j), v.onerror = he(ue), w.fail = ue, w.stop = function(mt) {
									w.stop = w.continue = w.continuePrimaryKey = w.advance = z, j(mt);
								};
							}), Y = function() {
								if (v.result) try {
									D();
								} catch (j) {
									w.fail(j);
								}
								else w.done = !0, w.start = function() {
									throw new Error("Cursor behind last entry");
								}, w.stop();
							};
							return v.onsuccess = H(function(j) {
								v.onsuccess = Y, Y();
							}), w.continue = R, w.continuePrimaryKey = F, w.advance = N, Y(), U;
						}, T(w);
					}, O);
				});
			}
			function d(g) {
				return function(I) {
					return new Promise(function(m, k) {
						m = H(m);
						var x = I.trans, S = I.values, T = I.limit, O = I.query, y = T === 1 / 0 ? void 0 : T, A = O.index, M = O.range, E = x.objectStore(p), _ = A.isPrimaryKey ? E : E.index(A.name), v = i(M);
						if (T === 0) return m({ result: [] });
						if (g) {
							var C = S ? _.getAll(v, y) : _.getAllKeys(v, y);
							C.onsuccess = function(N) {
								return m({ result: N.target.result });
							}, C.onerror = he(k);
						} else {
							var w = 0, R = S || !("openKeyCursor" in _) ? _.openCursor(v) : _.openKeyCursor(v), F = [];
							R.onsuccess = function(N) {
								var $ = R.result;
								if (!$) return m({ result: F });
								if (F.push(S ? $.value : $.primaryKey), ++w === T) return m({ result: F });
								$.continue();
							}, R.onerror = he(k);
						}
					});
				};
			}
			return {
				name: p,
				schema: h,
				mutate: b,
				getMany: function(g) {
					var I = g.trans, m = g.keys;
					return new Promise(function(k, x) {
						k = H(k);
						for (var S = I.objectStore(p), T = m.length, O = new Array(T), y = 0, A = 0, M, E = function(C) {
							var w = C.target;
							O[w._pos] = w.result, ++A === y && k(O);
						}, _ = he(x), v = 0; v < T; ++v) m[v] != null && (M = S.get(m[v]), M._pos = v, M.onsuccess = E, M.onerror = _, ++y);
						y === 0 && k(O);
					});
				},
				get: function(g) {
					var I = g.trans, m = g.key;
					return new Promise(function(k, x) {
						k = H(k);
						var S = I.objectStore(p).get(m);
						S.onsuccess = function(T) {
							return k(T.target.result);
						}, S.onerror = he(x);
					});
				},
				query: d(s),
				openCursor: f,
				count: function(g) {
					var I = g.query, m = g.trans, k = I.index, x = I.range;
					return new Promise(function(S, T) {
						var O = m.objectStore(p), y = k.isPrimaryKey ? O : O.index(k.name), A = i(x), M = A ? y.count(A) : y.count();
						M.onsuccess = H(function(E) {
							return S(E.target.result);
						}), M.onerror = he(T);
					});
				}
			};
		}
		var a = r(t, n), u = a.schema, s = a.hasGetAll, c = u.tables.map(function(h) {
			return o(h);
		}), l = {};
		return c.forEach(function(h) {
			return l[h.name] = h;
		}), {
			stack: "dbcore",
			transaction: t.transaction.bind(t),
			table: function(h) {
				if (!l[h]) throw new Error("Table '".concat(h, "' not found"));
				return l[h];
			},
			MIN_KEY: -1 / 0,
			MAX_KEY: ht(e),
			schema: u
		};
	}
	function eo(t, e) {
		return e.reduce(function(n, r) {
			var i = r.create;
			return V(V({}, n), i(n));
		}, t);
	}
	function to(t, e, n, r) {
		var i = n.IDBKeyRange;
		return n.indexedDB, { dbcore: eo(Zi(e, i, r), t.dbcore) };
	}
	function Bt(t, e) {
		var n = e.db;
		t.core = to(t._middlewares, n, t._deps, e).dbcore, t.tables.forEach(function(r) {
			var i = r.name;
			t.core.schema.tables.some(function(o) {
				return o.name === i;
			}) && (r.core = t.core.table(i), t[i] instanceof t.Table && (t[i].core = r.core));
		});
	}
	function Ft(t, e, n, r) {
		n.forEach(function(i) {
			var o = r[i];
			e.forEach(function(a) {
				var u = Gn(a, i);
				(!u || "value" in u && u.value === void 0) && (a === t.Transaction.prototype || a instanceof t.Transaction ? ge(a, i, {
					get: function() {
						return this.table(i);
					},
					set: function(s) {
						qn(this, i, {
							value: s,
							writable: !0,
							configurable: !0,
							enumerable: !0
						});
					}
				}) : a[i] = new t.Table(i, o));
			});
		});
	}
	function xn(t, e) {
		e.forEach(function(n) {
			for (var r in n) n[r] instanceof t.Table && delete n[r];
		});
	}
	function no(t, e) {
		return t._cfg.version - e._cfg.version;
	}
	function ro(t, e, n, r) {
		var i = t._dbSchema;
		n.objectStoreNames.contains("$meta") && !i.$meta && (i.$meta = In("$meta", Ar("")[0], []), t._storeNames.push("$meta"));
		var o = t._createTransaction("readwrite", t._storeNames, i);
		o.create(n), o._completion.catch(r);
		var a = o._reject.bind(o), u = B.transless || B;
		be(function() {
			if (B.trans = o, B.transless = u, e === 0) J(i).forEach(function(s) {
				En(n, s, i[s].primKey, i[s].indexes);
			}), Bt(t, n), P.follow(function() {
				return t.on.populate.fire(o);
			}).catch(a);
			else return Bt(t, n), oo(t, o, e).then(function(s) {
				return ao(t, s, o, n);
			}).catch(a);
		});
	}
	function io(t, e) {
		xr(t._dbSchema, e), e.db.version % 10 === 0 && !e.objectStoreNames.contains("$meta") && e.db.createObjectStore("$meta").add(Math.ceil(e.db.version / 10 - 1), "version");
		var n = Dt(t, t.idbdb, e);
		Vt(t, t._dbSchema, e);
		for (var r = An(n, t._dbSchema), i = function(c) {
			if (c.change.length || c.recreate) return console.warn("Unable to patch indexes of table ".concat(c.name, " because it has changes on the type of index or primary key.")), { value: void 0 };
			var l = e.objectStore(c.name);
			c.add.forEach(function(h) {
				fe && console.debug("Dexie upgrade patch: Creating missing index ".concat(c.name, ".").concat(h.src)), Kt(l, h);
			});
		}, o = 0, a = r.change; o < a.length; o++) {
			var u = a[o], s = i(u);
			if (typeof s == "object") return s.value;
		}
	}
	function oo(t, e, n) {
		return e.storeNames.includes("$meta") ? e.table("$meta").get("version").then(function(r) {
			return r ?? n;
		}) : P.resolve(n);
	}
	function ao(t, e, n, r) {
		var i = [], o = t._versions, a = t._dbSchema = Dt(t, t.idbdb, r), u = o.filter(function(c) {
			return c._cfg.version >= e;
		});
		if (u.length === 0) return P.resolve();
		u.forEach(function(c) {
			i.push(function() {
				var l = a, h = c._cfg.dbschema;
				Vt(t, l, r), Vt(t, h, r), a = t._dbSchema = h;
				var p = An(l, h);
				p.add.forEach(function(m) {
					En(r, m[0], m[1].primKey, m[1].indexes);
				}), p.change.forEach(function(m) {
					if (m.recreate) throw new K.Upgrade("Not yet support for changing primary key");
					var k = r.objectStore(m.name);
					m.add.forEach(function(x) {
						return Kt(k, x);
					}), m.change.forEach(function(x) {
						k.deleteIndex(x.name), Kt(k, x);
					}), m.del.forEach(function(x) {
						return k.deleteIndex(x);
					});
				});
				var b = c._cfg.contentUpgrade;
				if (b && c._cfg.version > e) {
					Bt(t, r), n._memoizedTables = {};
					var f = Xn(h);
					p.del.forEach(function(m) {
						f[m] = l[m];
					}), xn(t, [t.Transaction.prototype]), Ft(t, [t.Transaction.prototype], J(f), f), n.schema = f;
					var d = en(b);
					d && Ge();
					var g, I = P.follow(function() {
						if (g = b(n), g && d) {
							var m = _e.bind(null, null);
							g.then(m, m);
						}
					});
					return g && typeof g.then == "function" ? P.resolve(g) : I.then(function() {
						return g;
					});
				}
			}), i.push(function(l) {
				var h = c._cfg.dbschema;
				so(h, l), xn(t, [t.Transaction.prototype]), Ft(t, [t.Transaction.prototype], t._storeNames, t._dbSchema), n.schema = t._dbSchema;
			}), i.push(function(l) {
				t.idbdb.objectStoreNames.contains("$meta") && (Math.ceil(t.idbdb.version / 10) === c._cfg.version ? (t.idbdb.deleteObjectStore("$meta"), delete t._dbSchema.$meta, t._storeNames = t._storeNames.filter(function(h) {
					return h !== "$meta";
				})) : l.objectStore("$meta").put(c._cfg.version, "version"));
			});
		});
		function s() {
			return i.length ? P.resolve(i.shift()(n.idbtrans)).then(s) : P.resolve();
		}
		return s().then(function() {
			xr(a, r);
		});
	}
	function An(t, e) {
		var n = {
			del: [],
			add: [],
			change: []
		}, r;
		for (r in t) e[r] || n.del.push(r);
		for (r in e) {
			var i = t[r], o = e[r];
			if (!i) n.add.push([r, o]);
			else {
				var a = {
					name: r,
					def: o,
					recreate: !1,
					del: [],
					add: [],
					change: []
				};
				if ("" + (i.primKey.keyPath || "") != "" + (o.primKey.keyPath || "") || i.primKey.auto !== o.primKey.auto) a.recreate = !0, n.change.push(a);
				else {
					var u = i.idxByName, s = o.idxByName, c = void 0;
					for (c in u) s[c] || a.del.push(c);
					for (c in s) {
						var l = u[c], h = s[c];
						l ? l.src !== h.src && a.change.push(h) : a.add.push(h);
					}
					(a.del.length > 0 || a.add.length > 0 || a.change.length > 0) && n.change.push(a);
				}
			}
		}
		return n;
	}
	function En(t, e, n, r) {
		var i = t.db.createObjectStore(e, n.keyPath ? {
			keyPath: n.keyPath,
			autoIncrement: n.auto
		} : { autoIncrement: n.auto });
		return r.forEach(function(o) {
			return Kt(i, o);
		}), i;
	}
	function xr(t, e) {
		J(t).forEach(function(n) {
			e.db.objectStoreNames.contains(n) || (fe && console.debug("Dexie: Creating missing table", n), En(e, n, t[n].primKey, t[n].indexes));
		});
	}
	function so(t, e) {
		[].slice.call(e.db.objectStoreNames).forEach(function(n) {
			return t[n] == null && e.db.deleteObjectStore(n);
		});
	}
	function Kt(t, e) {
		t.createIndex(e.name, e.keyPath, {
			unique: e.unique,
			multiEntry: e.multi
		});
	}
	function Dt(t, e, n) {
		var r = {};
		return gt(e.objectStoreNames, 0).forEach(function(i) {
			for (var o = n.objectStore(i), a = o.keyPath, u = Sn(Ir(a), a || "", !0, !1, !!o.autoIncrement, a && typeof a != "string", !0), s = [], c = 0; c < o.indexNames.length; ++c) {
				var l = o.index(o.indexNames[c]);
				a = l.keyPath;
				var h = Sn(l.name, a, !!l.unique, !!l.multiEntry, !1, a && typeof a != "string", !1);
				s.push(h);
			}
			r[i] = In(i, u, s);
		}), r;
	}
	function uo(t, e, n) {
		t.verno = e.version / 10;
		var r = t._dbSchema = Dt(t, e, n);
		t._storeNames = gt(e.objectStoreNames, 0), Ft(t, [t._allTables], J(r), r);
	}
	function co(t, e) {
		var n = An(Dt(t, t.idbdb, e), t._dbSchema);
		return !(n.add.length || n.change.some(function(r) {
			return r.add.length || r.change.length;
		}));
	}
	function Vt(t, e, n) {
		for (var r = n.db.objectStoreNames, i = 0; i < r.length; ++i) {
			var o = r[i], a = n.objectStore(o);
			t._hasGetAll = "getAll" in a;
			for (var u = 0; u < a.indexNames.length; ++u) {
				var s = a.indexNames[u], c = a.index(s).keyPath, l = typeof c == "string" ? c : "[" + gt(c).join("+") + "]";
				if (e[o]) {
					var h = e[o].idxByName[l];
					h && (h.name = s, delete e[o].idxByName[l], e[o].idxByName[s] = h);
				}
			}
		}
		typeof navigator < "u" && /Safari/.test(navigator.userAgent) && !/(Chrome\/|Edge\/)/.test(navigator.userAgent) && te.WorkerGlobalScope && te instanceof te.WorkerGlobalScope && [].concat(navigator.userAgent.match(/Safari\/(\d*)/))[1] < 604 && (t._hasGetAll = !1);
	}
	function Ar(t) {
		return t.split(",").map(function(e, n) {
			e = e.trim();
			var r = e.replace(/([&*]|\+\+)/g, ""), i = /^\[/.test(r) ? r.match(/^\[(.*)\]$/)[1].split("+") : r;
			return Sn(r, i || null, /\&/.test(e), /\*/.test(e), /\+\+/.test(e), q(i), n === 0);
		});
	}
	var lo = (function() {
		function t() {}
		return t.prototype._parseStoresSpec = function(e, n) {
			J(e).forEach(function(r) {
				if (e[r] !== null) {
					var i = Ar(e[r]), o = i.shift();
					if (o.unique = !0, o.multi) throw new K.Schema("Primary key cannot be multi-valued");
					i.forEach(function(a) {
						if (a.auto) throw new K.Schema("Only primary key can be marked as autoIncrement (++)");
						if (!a.keyPath) throw new K.Schema("Index must have a name and cannot be an empty string");
					}), n[r] = In(r, o, i);
				}
			});
		}, t.prototype.stores = function(e) {
			var n = this.db;
			this._cfg.storesSource = this._cfg.storesSource ? ie(this._cfg.storesSource, e) : e;
			var r = n._versions, i = {}, o = {};
			return r.forEach(function(a) {
				ie(i, a._cfg.storesSource), o = a._cfg.dbschema = {}, a._parseStoresSpec(i, o);
			}), n._dbSchema = o, xn(n, [
				n._allTables,
				n,
				n.Transaction.prototype
			]), Ft(n, [
				n._allTables,
				n,
				n.Transaction.prototype,
				this._cfg.tables
			], J(o), o), n._storeNames = J(o), this;
		}, t.prototype.upgrade = function(e) {
			return this._cfg.contentUpgrade = rn(this._cfg.contentUpgrade || W, e), this;
		}, t;
	})();
	function fo(t) {
		return ct(lo.prototype, function(n) {
			this.db = t, this._cfg = {
				version: n,
				storesSource: null,
				dbschema: {},
				tables: {},
				contentUpgrade: null
			};
		});
	}
	function Mn(t, e) {
		var n = t._dbNamesDB;
		return n || (n = t._dbNamesDB = new vt(Tt, {
			addons: [],
			indexedDB: t,
			IDBKeyRange: e
		}), n.version(1).stores({ dbnames: "name" })), n.table("dbnames");
	}
	function Tn(t) {
		return t && typeof t.databases == "function";
	}
	function ho(t) {
		var e = t.indexedDB, n = t.IDBKeyRange;
		return Tn(e) ? Promise.resolve(e.databases()).then(function(r) {
			return r.map(function(i) {
				return i.name;
			}).filter(function(i) {
				return i !== Tt;
			});
		}) : Mn(e, n).toCollection().primaryKeys();
	}
	function po(t, e) {
		var n = t.indexedDB, r = t.IDBKeyRange;
		!Tn(n) && e !== Tt && Mn(n, r).put({ name: e }).catch(W);
	}
	function vo(t, e) {
		var n = t.indexedDB, r = t.IDBKeyRange;
		!Tn(n) && e !== Tt && Mn(n, r).delete(e).catch(W);
	}
	function Cn(t) {
		return be(function() {
			return B.letThrough = !0, t();
		});
	}
	function mo() {
		if (!(!navigator.userAgentData && /Safari\//.test(navigator.userAgent) && !/Chrom(e|ium)\//.test(navigator.userAgent)) || !indexedDB.databases) return Promise.resolve();
		var t;
		return new Promise(function(e) {
			var n = function() {
				return indexedDB.databases().finally(e);
			};
			t = setInterval(n, 100), n();
		}).finally(function() {
			return clearInterval(t);
		});
	}
	var On;
	function Pn(t) {
		return !("from" in t);
	}
	var ne = function(t, e) {
		if (this) ie(this, arguments.length ? {
			d: 1,
			from: t,
			to: arguments.length > 1 ? e : t
		} : { d: 0 });
		else {
			var n = new ne();
			return t && "d" in t && ie(n, t), n;
		}
	};
	je(ne.prototype, (On = {
		add: function(t) {
			return Nt(this, t), this;
		},
		addKey: function(t) {
			return pt(this, t, t), this;
		},
		addKeys: function(t) {
			var e = this;
			return t.forEach(function(n) {
				return pt(e, n, n);
			}), this;
		},
		hasKey: function(t) {
			var e = $t(this).next(t).value;
			return e && L(e.from, t) <= 0 && L(e.to, t) >= 0;
		}
	}, On[Zt] = function() {
		return $t(this);
	}, On));
	function pt(t, e, n) {
		var r = L(e, n);
		if (!isNaN(r)) {
			if (r > 0) throw RangeError();
			if (Pn(t)) return ie(t, {
				from: e,
				to: n,
				d: 1
			});
			var i = t.l, o = t.r;
			if (L(n, t.from) < 0) return i ? pt(i, e, n) : t.l = {
				from: e,
				to: n,
				d: 1,
				l: null,
				r: null
			}, Er(t);
			if (L(e, t.to) > 0) return o ? pt(o, e, n) : t.r = {
				from: e,
				to: n,
				d: 1,
				l: null,
				r: null
			}, Er(t);
			L(e, t.from) < 0 && (t.from = e, t.l = null, t.d = o ? o.d + 1 : 1), L(n, t.to) > 0 && (t.to = n, t.r = null, t.d = t.l ? t.l.d + 1 : 1);
			var a = !t.r;
			i && !t.l && Nt(t, i), o && a && Nt(t, o);
		}
	}
	function Nt(t, e) {
		function n(r, i) {
			var o = i.from, a = i.to, u = i.l, s = i.r;
			pt(r, o, a), u && n(r, u), s && n(r, s);
		}
		Pn(e) || n(t, e);
	}
	function yo(t, e) {
		var n = $t(e), r = n.next();
		if (r.done) return !1;
		for (var i = r.value, o = $t(t), a = o.next(i.from), u = a.value; !r.done && !a.done;) {
			if (L(u.from, i.to) <= 0 && L(u.to, i.from) >= 0) return !0;
			L(i.from, u.from) < 0 ? i = (r = n.next(u.from)).value : u = (a = o.next(i.from)).value;
		}
		return !1;
	}
	function $t(t) {
		var e = Pn(t) ? null : {
			s: 0,
			n: t
		};
		return { next: function(n) {
			for (var r = arguments.length > 0; e;) switch (e.s) {
				case 0: if (e.s = 1, r) for (; e.n.l && L(n, e.n.from) < 0;) e = {
					up: e,
					n: e.n.l,
					s: 1
				};
				else for (; e.n.l;) e = {
					up: e,
					n: e.n.l,
					s: 1
				};
				case 1: if (e.s = 2, !r || L(n, e.n.to) <= 0) return {
					value: e.n,
					done: !1
				};
				case 2: if (e.n.r) {
					e.s = 3, e = {
						up: e,
						n: e.n.r,
						s: 0
					};
					continue;
				}
				case 3: e = e.up;
			}
			return { done: !0 };
		} };
	}
	function Er(t) {
		var e, n, r = (((e = t.r) === null || e === void 0 ? void 0 : e.d) || 0) - (((n = t.l) === null || n === void 0 ? void 0 : n.d) || 0), i = r > 1 ? "r" : r < -1 ? "l" : "";
		if (i) {
			var o = i === "r" ? "l" : "r", a = V({}, t), u = t[i];
			t.from = u.from, t.to = u.to, t[i] = u[i], a[i] = u[o], t[o] = a, a.d = Mr(a);
		}
		t.d = Mr(t);
	}
	function Mr(t) {
		var e = t.r, n = t.l;
		return (e ? n ? Math.max(e.d, n.d) : e.d : n ? n.d : 0) + 1;
	}
	function jt(t, e) {
		return J(e).forEach(function(n) {
			t[n] ? Nt(t[n], e[n]) : t[n] = er(e[n]);
		}), t;
	}
	function Rn(t, e) {
		return t.all || e.all || Object.keys(t).some(function(n) {
			return e[n] && yo(e[n], t[n]);
		});
	}
	var De = {}, Bn = {}, Fn = !1;
	function zt(t, e) {
		jt(Bn, t), Fn || (Fn = !0, setTimeout(function() {
			Fn = !1;
			var n = Bn;
			Bn = {}, Kn(n, !1);
		}, 0));
	}
	function Kn(t, e) {
		e === void 0 && (e = !1);
		var n = /* @__PURE__ */ new Set();
		if (t.all) for (var r = 0, i = Object.values(De); r < i.length; r++) {
			var o = i[r];
			Tr(o, t, n, e);
		}
		else for (var a in t) {
			var u = /^idb\:\/\/(.*)\/(.*)\//.exec(a);
			if (u) {
				var s = u[1], c = u[2], o = De["idb://".concat(s, "/").concat(c)];
				o && Tr(o, t, n, e);
			}
		}
		n.forEach(function(l) {
			return l();
		});
	}
	function Tr(t, e, n, r) {
		for (var i = [], o = 0, a = Object.entries(t.queries.query); o < a.length; o++) {
			for (var u = a[o], s = u[0], c = u[1], l = [], h = 0, p = c; h < p.length; h++) {
				var b = p[h];
				Rn(e, b.obsSet) ? b.subscribers.forEach(function(I) {
					return n.add(I);
				}) : r && l.push(b);
			}
			r && i.push([s, l]);
		}
		if (r) for (var f = 0, d = i; f < d.length; f++) {
			var g = d[f], s = g[0], l = g[1];
			t.queries.query[s] = l;
		}
	}
	function go(t) {
		var e = t._state, n = t._deps.indexedDB;
		if (e.isBeingOpened || t.idbdb) return e.dbReadyPromise.then(function() {
			return e.dbOpenError ? G(e.dbOpenError) : t;
		});
		e.isBeingOpened = !0, e.dbOpenError = null, e.openComplete = !1;
		var r = e.openCanceller, i = Math.round(t.verno * 10), o = !1;
		function a() {
			if (e.openCanceller !== r) throw new K.DatabaseClosed("db.open() was cancelled");
		}
		var u = e.dbReadyResolve, s = null, c = !1, l = function() {
			return new P(function(h, p) {
				if (a(), !n) throw new K.MissingAPI();
				var b = t.name, f = e.autoSchema || !i ? n.open(b) : n.open(b, i);
				if (!f) throw new K.MissingAPI();
				f.onerror = he(p), f.onblocked = H(t._fireOnBlocked), f.onupgradeneeded = H(function(d) {
					if (s = f.transaction, e.autoSchema && !t._options.allowEmptyDB) {
						f.onerror = lt, s.abort(), f.result.close();
						var g = n.deleteDatabase(b);
						g.onsuccess = g.onerror = H(function() {
							p(new K.NoSuchDatabase("Database ".concat(b, " doesnt exist")));
						});
					} else {
						s.onerror = he(p);
						var I = d.oldVersion > Math.pow(2, 62) ? 0 : d.oldVersion;
						c = I < 1, t.idbdb = f.result, o && io(t, s), ro(t, I / 10, s, p);
					}
				}, p), f.onsuccess = H(function() {
					s = null;
					var d = t.idbdb = f.result, g = gt(d.objectStoreNames);
					if (g.length > 0) try {
						var I = d.transaction(Qi(g), "readonly");
						if (e.autoSchema) uo(t, d, I);
						else if (Vt(t, t._dbSchema, I), !co(t, I) && !o) return console.warn("Dexie SchemaDiff: Schema was extended without increasing the number passed to db.version(). Dexie will add missing parts and increment native version number to workaround this."), d.close(), i = d.version + 1, o = !0, h(l());
						Bt(t, I);
					} catch {}
					Ye.push(t), d.onversionchange = H(function(m) {
						e.vcFired = !0, t.on("versionchange").fire(m);
					}), d.onclose = H(function(m) {
						t.on("close").fire(m);
					}), c && po(t._deps, b), h();
				}, p);
			}).catch(function(h) {
				switch (h?.name) {
					case "UnknownError":
						if (e.PR1398_maxLoop > 0) return e.PR1398_maxLoop--, console.warn("Dexie: Workaround for Chrome UnknownError on open()"), l();
						break;
					case "VersionError": if (i > 0) return i = 0, l();
				}
				return P.reject(h);
			});
		};
		return P.race([r, (typeof navigator > "u" ? P.resolve() : mo()).then(l)]).then(function() {
			return a(), e.onReadyBeingFired = [], P.resolve(Cn(function() {
				return t.on.ready.fire(t.vip);
			})).then(function h() {
				if (e.onReadyBeingFired.length > 0) {
					var p = e.onReadyBeingFired.reduce(rn, W);
					return e.onReadyBeingFired = [], P.resolve(Cn(function() {
						return p(t.vip);
					})).then(h);
				}
			});
		}).finally(function() {
			e.openCanceller === r && (e.onReadyBeingFired = null, e.isBeingOpened = !1);
		}).catch(function(h) {
			e.dbOpenError = h;
			try {
				s && s.abort();
			} catch {}
			return r === e.openCanceller && t._close(), G(h);
		}).finally(function() {
			e.openComplete = !0, u();
		}).then(function() {
			if (c) {
				var h = {};
				t.tables.forEach(function(p) {
					p.schema.indexes.forEach(function(b) {
						b.name && (h["idb://".concat(t.name, "/").concat(p.name, "/").concat(b.name)] = new ne(-1 / 0, [[[]]]));
					}), h["idb://".concat(t.name, "/").concat(p.name, "/")] = h["idb://".concat(t.name, "/").concat(p.name, "/:dels")] = new ne(-1 / 0, [[[]]]);
				}), ke(ft).fire(h), Kn(h, !0);
			}
			return t;
		});
	}
	function Dn(t) {
		var e = function(a) {
			return t.next(a);
		}, n = function(a) {
			return t.throw(a);
		}, r = o(e), i = o(n);
		function o(a) {
			return function(u) {
				var s = a(u), c = s.value;
				return s.done ? c : !c || typeof c.then != "function" ? q(c) ? Promise.all(c).then(r, i) : r(c) : c.then(r, i);
			};
		}
		return o(e)();
	}
	function wo(t, e, n) {
		var r = arguments.length;
		if (r < 2) throw new K.InvalidArgument("Too few arguments");
		for (var i = new Array(r - 1); --r;) i[r - 1] = arguments[r];
		return n = i.pop(), [
			t,
			Jn(i),
			n
		];
	}
	function Cr(t, e, n, r, i) {
		return P.resolve().then(function() {
			var o = B.transless || B, a = t._createTransaction(e, n, t._dbSchema, r);
			a.explicit = !0;
			var u = {
				trans: a,
				transless: o
			};
			if (r) a.idbtrans = r.idbtrans;
			else try {
				a.create(), a.idbtrans._explicit = !0, t._state.PR1398_maxLoop = 3;
			} catch (h) {
				return h.name === nn.InvalidState && t.isOpen() && --t._state.PR1398_maxLoop > 0 ? (console.warn("Dexie: Need to reopen db"), t.close({ disableAutoOpen: !1 }), t.open().then(function() {
					return Cr(t, e, n, null, i);
				})) : G(h);
			}
			var s = en(i);
			s && Ge();
			var c, l = P.follow(function() {
				if (c = i.call(a, a), c) if (s) {
					var h = _e.bind(null, null);
					c.then(h, h);
				} else typeof c.next == "function" && typeof c.throw == "function" && (c = Dn(c));
			}, u);
			return (c && typeof c.then == "function" ? P.resolve(c).then(function(h) {
				return a.active ? h : G(new K.PrematureCommit("Transaction committed too early. See http://bit.ly/2kdckMn"));
			}) : l.then(function() {
				return c;
			})).then(function(h) {
				return r && a._resolve(), a._completion.then(function() {
					return h;
				});
			}).catch(function(h) {
				return a._reject(h), G(h);
			});
		});
	}
	function Lt(t, e, n) {
		for (var r = q(t) ? t.slice() : [t], i = 0; i < n; ++i) r.push(e);
		return r;
	}
	function bo(t) {
		return V(V({}, t), { table: function(e) {
			var n = t.table(e), r = n.schema, i = {}, o = [];
			function a(f, d, g) {
				var I = dt(f), m = i[I] = i[I] || [], k = f == null ? 0 : typeof f == "string" ? 1 : f.length, x = d > 0, S = V(V({}, g), {
					name: x ? "".concat(I, "(virtual-from:").concat(g.name, ")") : g.name,
					lowLevelIndex: g,
					isVirtual: x,
					keyTail: d,
					keyLength: k,
					extractKey: kn(f),
					unique: !x && g.unique
				});
				return m.push(S), S.isPrimaryKey || o.push(S), k > 1 && a(k === 2 ? f[0] : f.slice(0, k - 1), d + 1, g), m.sort(function(T, O) {
					return T.keyTail - O.keyTail;
				}), S;
			}
			var u = a(r.primaryKey.keyPath, 0, r.primaryKey);
			i[":id"] = [u];
			for (var s = 0, c = r.indexes; s < c.length; s++) {
				var l = c[s];
				a(l.keyPath, 0, l);
			}
			function h(f) {
				var d = i[dt(f)];
				return d && d[0];
			}
			function p(f, d) {
				return {
					type: f.type === 1 ? 2 : f.type,
					lower: Lt(f.lower, f.lowerOpen ? t.MAX_KEY : t.MIN_KEY, d),
					lowerOpen: !0,
					upper: Lt(f.upper, f.upperOpen ? t.MIN_KEY : t.MAX_KEY, d),
					upperOpen: !0
				};
			}
			function b(f) {
				var d = f.query.index;
				return d.isVirtual ? V(V({}, f), { query: {
					index: d.lowLevelIndex,
					range: p(f.query.range, d.keyTail)
				} }) : f;
			}
			return V(V({}, n), {
				schema: V(V({}, r), {
					primaryKey: u,
					indexes: o,
					getIndexByKeyPath: h
				}),
				count: function(f) {
					return n.count(b(f));
				},
				query: function(f) {
					return n.query(b(f));
				},
				openCursor: function(f) {
					var d = f.query.index, g = d.keyTail, I = d.isVirtual, m = d.keyLength;
					if (!I) return n.openCursor(f);
					function k(x) {
						function S(T) {
							T != null ? x.continue(Lt(T, f.reverse ? t.MAX_KEY : t.MIN_KEY, g)) : f.unique ? x.continue(x.key.slice(0, m).concat(f.reverse ? t.MIN_KEY : t.MAX_KEY, g)) : x.continue();
						}
						return Object.create(x, {
							continue: { value: S },
							continuePrimaryKey: { value: function(T, O) {
								x.continuePrimaryKey(Lt(T, t.MAX_KEY, g), O);
							} },
							primaryKey: { get: function() {
								return x.primaryKey;
							} },
							key: { get: function() {
								var T = x.key;
								return m === 1 ? T[0] : T.slice(0, m);
							} },
							value: { get: function() {
								return x.value;
							} }
						});
					}
					return n.openCursor(b(f)).then(function(x) {
						return x && k(x);
					});
				}
			});
		} });
	}
	var _o = {
		stack: "dbcore",
		name: "VirtualIndexMiddleware",
		level: 1,
		create: bo
	};
	function Vn(t, e, n, r) {
		return n = n || {}, r = r || "", J(t).forEach(function(i) {
			if (!re(e, i)) n[r + i] = void 0;
			else {
				var o = t[i], a = e[i];
				if (typeof o == "object" && typeof a == "object" && o && a) {
					var u = Jt(o);
					u !== Jt(a) ? n[r + i] = e[i] : u === "Object" ? Vn(o, a, n, r + i + ".") : o !== a && (n[r + i] = e[i]);
				} else o !== a && (n[r + i] = e[i]);
			}
		}), J(e).forEach(function(i) {
			re(t, i) || (n[r + i] = e[i]);
		}), n;
	}
	function Nn(t, e) {
		return e.type === "delete" ? e.keys : e.keys || e.values.map(t.extractKey);
	}
	var So = {
		stack: "dbcore",
		name: "HooksMiddleware",
		level: 2,
		create: function(t) {
			return V(V({}, t), { table: function(e) {
				var n = t.table(e), r = n.schema.primaryKey;
				return V(V({}, n), { mutate: function(i) {
					var o = B.trans, a = o.table(e).hook, u = a.deleting, s = a.creating, c = a.updating;
					switch (i.type) {
						case "add":
							if (s.fire === W) break;
							return o._promise("readwrite", function() {
								return l(i);
							}, !0);
						case "put":
							if (s.fire === W && c.fire === W) break;
							return o._promise("readwrite", function() {
								return l(i);
							}, !0);
						case "delete":
							if (u.fire === W) break;
							return o._promise("readwrite", function() {
								return l(i);
							}, !0);
						case "deleteRange":
							if (u.fire === W) break;
							return o._promise("readwrite", function() {
								return h(i);
							}, !0);
					}
					return n.mutate(i);
					function l(b) {
						var f = B.trans, d = b.keys || Nn(r, b);
						if (!d) throw new Error("Keys missing");
						return b = b.type === "add" || b.type === "put" ? V(V({}, b), { keys: d }) : V({}, b), b.type !== "delete" && (b.values = yt([], b.values, !0)), b.keys && (b.keys = yt([], b.keys, !0)), Io(n, b, d).then(function(g) {
							var I = d.map(function(m, k) {
								var x = g[k], S = {
									onerror: null,
									onsuccess: null
								};
								if (b.type === "delete") u.fire.call(S, m, x, f);
								else if (b.type === "add" || x === void 0) {
									var T = s.fire.call(S, m, b.values[k], f);
									m == null && T != null && (m = T, b.keys[k] = m, r.outbound || oe(b.values[k], r.keyPath, m));
								} else {
									var O = Vn(x, b.values[k]), y = c.fire.call(S, O, m, x, f);
									if (y) {
										var A = b.values[k];
										Object.keys(y).forEach(function(M) {
											re(A, M) ? A[M] = y[M] : oe(A, M, y[M]);
										});
									}
								}
								return S;
							});
							return n.mutate(b).then(function(m) {
								for (var k = m.failures, x = m.results, S = m.numFailures, T = m.lastResult, O = 0; O < d.length; ++O) {
									var y = x ? x[O] : d[O], A = I[O];
									y == null ? A.onerror && A.onerror(k[O]) : A.onsuccess && A.onsuccess(b.type === "put" && g[O] ? b.values[O] : y);
								}
								return {
									failures: k,
									results: x,
									numFailures: S,
									lastResult: T
								};
							}).catch(function(m) {
								return I.forEach(function(k) {
									return k.onerror && k.onerror(m);
								}), Promise.reject(m);
							});
						});
					}
					function h(b) {
						return p(b.trans, b.range, 1e4);
					}
					function p(b, f, d) {
						return n.query({
							trans: b,
							values: !1,
							query: {
								index: r,
								range: f
							},
							limit: d
						}).then(function(g) {
							var I = g.result;
							return l({
								type: "delete",
								keys: I,
								trans: b
							}).then(function(m) {
								return m.numFailures > 0 ? Promise.reject(m.failures[0]) : I.length < d ? {
									failures: [],
									numFailures: 0,
									lastResult: void 0
								} : p(b, V(V({}, f), {
									lower: I[I.length - 1],
									lowerOpen: !0
								}), d);
							});
						});
					}
				} });
			} });
		}
	};
	function Io(t, e, n) {
		return e.type === "add" ? Promise.resolve([]) : t.getMany({
			trans: e.trans,
			keys: n,
			cache: "immutable"
		});
	}
	function Or(t, e, n) {
		try {
			if (!e || e.keys.length < t.length) return null;
			for (var r = [], i = 0, o = 0; i < e.keys.length && o < t.length; ++i) L(e.keys[i], t[o]) === 0 && (r.push(n ? Me(e.values[i]) : e.values[i]), ++o);
			return r.length === t.length ? r : null;
		} catch {
			return null;
		}
	}
	var ko = {
		stack: "dbcore",
		level: -1,
		create: function(t) {
			return { table: function(e) {
				var n = t.table(e);
				return V(V({}, n), {
					getMany: function(r) {
						if (!r.cache) return n.getMany(r);
						var i = Or(r.keys, r.trans._cache, r.cache === "clone");
						return i ? P.resolve(i) : n.getMany(r).then(function(o) {
							return r.trans._cache = {
								keys: r.keys,
								values: r.cache === "clone" ? Me(o) : o
							}, o;
						});
					},
					mutate: function(r) {
						return r.type !== "add" && (r.trans._cache = null), n.mutate(r);
					}
				});
			} };
		}
	};
	function Pr(t, e) {
		return t.trans.mode === "readonly" && !!t.subscr && !t.trans.explicit && t.trans.db._options.cache !== "disabled" && !e.schema.primaryKey.outbound;
	}
	function Rr(t, e) {
		switch (t) {
			case "query": return e.values && !e.unique;
			case "get": return !1;
			case "getMany": return !1;
			case "count": return !1;
			case "openCursor": return !1;
		}
	}
	var xo = {
		stack: "dbcore",
		level: 0,
		name: "Observability",
		create: function(t) {
			var e = t.schema.name, n = new ne(t.MIN_KEY, t.MAX_KEY);
			return V(V({}, t), {
				transaction: function(r, i, o) {
					if (B.subscr && i !== "readonly") throw new K.ReadOnly("Readwrite transaction in liveQuery context. Querier source: ".concat(B.querier));
					return t.transaction(r, i, o);
				},
				table: function(r) {
					var i = t.table(r), o = i.schema, a = o.primaryKey, u = o.indexes, s = a.extractKey, c = a.outbound, l = a.autoIncrement && u.filter(function(f) {
						return f.compound && f.keyPath.includes(a.keyPath);
					}), h = V(V({}, i), { mutate: function(f) {
						var d, g, I = f.trans, m = f.mutatedParts || (f.mutatedParts = {}), k = function(v) {
							var C = "idb://".concat(e, "/").concat(r, "/").concat(v);
							return m[C] || (m[C] = new ne());
						}, x = k(""), S = k(":dels"), T = f.type, O = f.type === "deleteRange" ? [f.range] : f.type === "delete" ? [f.keys] : f.values.length < 50 ? [Nn(a, f).filter(function(v) {
							return v;
						}), f.values] : [], y = O[0], A = O[1], M = f.trans._cache;
						if (q(y)) {
							x.addKeys(y);
							var E = T === "delete" || y.length === A.length ? Or(y, M) : null;
							E || S.addKeys(y), (E || A) && Ao(k, o, E, A);
						} else if (y) {
							var _ = {
								from: (d = y.lower) !== null && d !== void 0 ? d : t.MIN_KEY,
								to: (g = y.upper) !== null && g !== void 0 ? g : t.MAX_KEY
							};
							S.add(_), x.add(_);
						} else x.add(n), S.add(n), o.indexes.forEach(function(v) {
							return k(v.name).add(n);
						});
						return i.mutate(f).then(function(v) {
							return y && (f.type === "add" || f.type === "put") && (x.addKeys(v.results), l && l.forEach(function(C) {
								for (var w = f.values.map(function($) {
									return C.extractKey($);
								}), R = C.keyPath.findIndex(function($) {
									return $ === a.keyPath;
								}), F = 0, N = v.results.length; F < N; ++F) w[F][R] = v.results[F];
								k(C.name).addKeys(w);
							})), I.mutatedParts = jt(I.mutatedParts || {}, m), v;
						});
					} }), p = function(f) {
						var d, g, I = f.query, m = I.index, k = I.range;
						return [m, new ne((d = k.lower) !== null && d !== void 0 ? d : t.MIN_KEY, (g = k.upper) !== null && g !== void 0 ? g : t.MAX_KEY)];
					}, b = {
						get: function(f) {
							return [a, new ne(f.key)];
						},
						getMany: function(f) {
							return [a, new ne().addKeys(f.keys)];
						},
						count: p,
						query: p,
						openCursor: p
					};
					return J(b).forEach(function(f) {
						h[f] = function(d) {
							var g = B.subscr, I = !!g, m = Pr(B, i) && Rr(f, d) ? d.obsSet = {} : g;
							if (I) {
								var k = function(M) {
									var E = "idb://".concat(e, "/").concat(r, "/").concat(M);
									return m[E] || (m[E] = new ne());
								}, x = k(""), S = k(":dels"), T = b[f](d), O = T[0], y = T[1];
								if (f === "query" && O.isPrimaryKey && !d.values ? S.add(y) : k(O.name || "").add(y), !O.isPrimaryKey) if (f === "count") S.add(n);
								else {
									var A = f === "query" && c && d.values && i.query(V(V({}, d), { values: !1 }));
									return i[f].apply(this, arguments).then(function(M) {
										if (f === "query") {
											if (c && d.values) return A.then(function(C) {
												var w = C.result;
												return x.addKeys(w), M;
											});
											var E = d.values ? M.result.map(s) : M.result;
											d.values ? x.addKeys(E) : S.addKeys(E);
										} else if (f === "openCursor") {
											var _ = M, v = d.values;
											return _ && Object.create(_, {
												key: { get: function() {
													return S.addKey(_.primaryKey), _.key;
												} },
												primaryKey: { get: function() {
													var C = _.primaryKey;
													return S.addKey(C), C;
												} },
												value: { get: function() {
													return v && x.addKey(_.primaryKey), _.value;
												} }
											});
										}
										return M;
									});
								}
							}
							return i[f].apply(this, arguments);
						};
					}), h;
				}
			});
		}
	};
	function Ao(t, e, n, r) {
		function i(o) {
			var a = t(o.name || "");
			function u(c) {
				return c != null ? o.extractKey(c) : null;
			}
			var s = function(c) {
				return o.multiEntry && q(c) ? c.forEach(function(l) {
					return a.addKey(l);
				}) : a.addKey(c);
			};
			(n || r).forEach(function(c, l) {
				var h = n && u(n[l]), p = r && u(r[l]);
				L(h, p) !== 0 && (h != null && s(h), p != null && s(p));
			});
		}
		e.indexes.forEach(i);
	}
	function Br(t, e, n) {
		if (n.numFailures === 0) return e;
		if (e.type === "deleteRange") return null;
		var r = e.keys ? e.keys.length : "values" in e && e.values ? e.values.length : 1;
		if (n.numFailures === r) return null;
		var i = V({}, e);
		return q(i.keys) && (i.keys = i.keys.filter(function(o, a) {
			return !(a in n.failures);
		})), "values" in i && q(i.values) && (i.values = i.values.filter(function(o, a) {
			return !(a in n.failures);
		})), i;
	}
	function Eo(t, e) {
		return e.lower === void 0 ? !0 : e.lowerOpen ? L(t, e.lower) > 0 : L(t, e.lower) >= 0;
	}
	function Mo(t, e) {
		return e.upper === void 0 ? !0 : e.upperOpen ? L(t, e.upper) < 0 : L(t, e.upper) <= 0;
	}
	function $n(t, e) {
		return Eo(t, e) && Mo(t, e);
	}
	function Fr(t, e, n, r, i, o) {
		if (!n || n.length === 0) return t;
		var a = e.query.index, u = a.multiEntry, s = e.query.range, c = r.schema.primaryKey.extractKey, l = a.extractKey, h = (a.lowLevelIndex || a).extractKey, p = n.reduce(function(b, f) {
			var d = b, g = [];
			if (f.type === "add" || f.type === "put") for (var I = new ne(), m = f.values.length - 1; m >= 0; --m) {
				var k = f.values[m], x = c(k);
				if (!I.hasKey(x)) {
					var S = l(k);
					(u && q(S) ? S.some(function(M) {
						return $n(M, s);
					}) : $n(S, s)) && (I.addKey(x), g.push(k));
				}
			}
			switch (f.type) {
				case "add":
					var T = new ne().addKeys(e.values ? b.map(function(M) {
						return c(M);
					}) : b);
					d = b.concat(e.values ? g.filter(function(M) {
						var E = c(M);
						return T.hasKey(E) ? !1 : (T.addKey(E), !0);
					}) : g.map(function(M) {
						return c(M);
					}).filter(function(M) {
						return T.hasKey(M) ? !1 : (T.addKey(M), !0);
					}));
					break;
				case "put":
					var O = new ne().addKeys(f.values.map(function(M) {
						return c(M);
					}));
					d = b.filter(function(M) {
						return !O.hasKey(e.values ? c(M) : M);
					}).concat(e.values ? g : g.map(function(M) {
						return c(M);
					}));
					break;
				case "delete":
					var y = new ne().addKeys(f.keys);
					d = b.filter(function(M) {
						return !y.hasKey(e.values ? c(M) : M);
					});
					break;
				case "deleteRange":
					var A = f.range;
					d = b.filter(function(M) {
						return !$n(c(M), A);
					});
			}
			return d;
		}, t);
		return p === t ? t : (p.sort(function(b, f) {
			return L(h(b), h(f)) || L(c(b), c(f));
		}), e.limit && e.limit < 1 / 0 && (p.length > e.limit ? p.length = e.limit : t.length === e.limit && p.length < e.limit && (i.dirty = !0)), o ? Object.freeze(p) : p);
	}
	function Kr(t, e) {
		return L(t.lower, e.lower) === 0 && L(t.upper, e.upper) === 0 && !!t.lowerOpen == !!e.lowerOpen && !!t.upperOpen == !!e.upperOpen;
	}
	function To(t, e, n, r) {
		if (t === void 0) return e !== void 0 ? -1 : 0;
		if (e === void 0) return 1;
		var i = L(t, e);
		if (i === 0) {
			if (n && r) return 0;
			if (n) return 1;
			if (r) return -1;
		}
		return i;
	}
	function Co(t, e, n, r) {
		if (t === void 0) return e !== void 0 ? 1 : 0;
		if (e === void 0) return -1;
		var i = L(t, e);
		if (i === 0) {
			if (n && r) return 0;
			if (n) return -1;
			if (r) return 1;
		}
		return i;
	}
	function Oo(t, e) {
		return To(t.lower, e.lower, t.lowerOpen, e.lowerOpen) <= 0 && Co(t.upper, e.upper, t.upperOpen, e.upperOpen) >= 0;
	}
	function Po(t, e, n, r) {
		var i = De["idb://".concat(t, "/").concat(e)];
		if (!i) return [];
		var o = i.queries[n];
		if (!o) return [
			null,
			!1,
			i,
			null
		];
		var a = o[(r.query ? r.query.index.name : null) || ""];
		if (!a) return [
			null,
			!1,
			i,
			null
		];
		switch (n) {
			case "query":
				var u = a.find(function(c) {
					return c.req.limit === r.limit && c.req.values === r.values && Kr(c.req.query.range, r.query.range);
				});
				return u ? [
					u,
					!0,
					i,
					a
				] : [
					a.find(function(c) {
						return ("limit" in c.req ? c.req.limit : 1 / 0) >= r.limit && (r.values ? c.req.values : !0) && Oo(c.req.query.range, r.query.range);
					}),
					!1,
					i,
					a
				];
			case "count":
				var s = a.find(function(c) {
					return Kr(c.req.query.range, r.query.range);
				});
				return [
					s,
					!!s,
					i,
					a
				];
		}
	}
	function Ro(t, e, n, r) {
		t.subscribers.add(n), r.addEventListener("abort", function() {
			t.subscribers.delete(n), t.subscribers.size === 0 && Bo(t, e);
		});
	}
	function Bo(t, e) {
		setTimeout(function() {
			t.subscribers.size === 0 && Te(e, t);
		}, 3e3);
	}
	var Fo = {
		stack: "dbcore",
		level: 0,
		name: "Cache",
		create: function(t) {
			var e = t.schema.name;
			return V(V({}, t), {
				transaction: function(n, r, i) {
					var o = t.transaction(n, r, i);
					if (r === "readwrite") {
						var a = new AbortController(), u = a.signal, s = function(c) {
							return function() {
								if (a.abort(), r === "readwrite") {
									for (var l = /* @__PURE__ */ new Set(), h = 0, p = n; h < p.length; h++) {
										var b = p[h], f = De["idb://".concat(e, "/").concat(b)];
										if (f) {
											var d = t.table(b), g = f.optimisticOps.filter(function(v) {
												return v.trans === o;
											});
											if (o._explicit && c && o.mutatedParts) for (var I = 0, m = Object.values(f.queries.query); I < m.length; I++) for (var k = m[I], x = 0, S = k.slice(); x < S.length; x++) {
												var T = S[x];
												Rn(T.obsSet, o.mutatedParts) && (Te(k, T), T.subscribers.forEach(function(v) {
													return l.add(v);
												}));
											}
											else if (g.length > 0) {
												f.optimisticOps = f.optimisticOps.filter(function(v) {
													return v.trans !== o;
												});
												for (var O = 0, y = Object.values(f.queries.query); O < y.length; O++) for (var k = y[O], A = 0, M = k.slice(); A < M.length; A++) {
													var T = M[A];
													if (T.res != null && o.mutatedParts) if (c && !T.dirty) {
														var E = Object.isFrozen(T.res), _ = Fr(T.res, T.req, g, d, T, E);
														T.dirty ? (Te(k, T), T.subscribers.forEach(function(w) {
															return l.add(w);
														})) : _ !== T.res && (T.res = _, T.promise = P.resolve({ result: _ }));
													} else T.dirty && Te(k, T), T.subscribers.forEach(function(w) {
														return l.add(w);
													});
												}
											}
										}
									}
									l.forEach(function(v) {
										return v();
									});
								}
							};
						};
						o.addEventListener("abort", s(!1), { signal: u }), o.addEventListener("error", s(!1), { signal: u }), o.addEventListener("complete", s(!0), { signal: u });
					}
					return o;
				},
				table: function(n) {
					var r = t.table(n), i = r.schema.primaryKey;
					return V(V({}, r), {
						mutate: function(o) {
							var a = B.trans;
							if (i.outbound || a.db._options.cache === "disabled" || a.explicit || a.idbtrans.mode !== "readwrite") return r.mutate(o);
							var u = De["idb://".concat(e, "/").concat(n)];
							if (!u) return r.mutate(o);
							var s = r.mutate(o);
							return (o.type === "add" || o.type === "put") && (o.values.length >= 50 || Nn(i, o).some(function(c) {
								return c == null;
							})) ? s.then(function(c) {
								var l = Br(u, V(V({}, o), { values: o.values.map(function(h, p) {
									var b;
									if (c.failures[p]) return h;
									var f = !((b = i.keyPath) === null || b === void 0) && b.includes(".") ? Me(h) : V({}, h);
									return oe(f, i.keyPath, c.results[p]), f;
								}) }), c);
								u.optimisticOps.push(l), queueMicrotask(function() {
									return o.mutatedParts && zt(o.mutatedParts);
								});
							}) : (u.optimisticOps.push(o), o.mutatedParts && zt(o.mutatedParts), s.then(function(c) {
								if (c.numFailures > 0) {
									Te(u.optimisticOps, o);
									var l = Br(u, o, c);
									l && u.optimisticOps.push(l), o.mutatedParts && zt(o.mutatedParts);
								}
							}), s.catch(function() {
								Te(u.optimisticOps, o), o.mutatedParts && zt(o.mutatedParts);
							})), s;
						},
						query: function(o) {
							var a;
							if (!Pr(B, r) || !Rr("query", o)) return r.query(o);
							var u = ((a = B.trans) === null || a === void 0 ? void 0 : a.db._options.cache) === "immutable", s = B, c = s.requery, l = s.signal, h = Po(e, n, "query", o), p = h[0], b = h[1], f = h[2], d = h[3];
							if (p && b) p.obsSet = o.obsSet;
							else {
								var g = r.query(o).then(function(I) {
									var m = I.result;
									if (p && (p.res = m), u) {
										for (var k = 0, x = m.length; k < x; ++k) Object.freeze(m[k]);
										Object.freeze(m);
									} else I.result = Me(m);
									return I;
								}).catch(function(I) {
									return d && p && Te(d, p), Promise.reject(I);
								});
								p = {
									obsSet: o.obsSet,
									promise: g,
									subscribers: /* @__PURE__ */ new Set(),
									type: "query",
									req: o,
									dirty: !1
								}, d ? d.push(p) : (d = [p], f || (f = De["idb://".concat(e, "/").concat(n)] = {
									queries: {
										query: {},
										count: {}
									},
									objs: /* @__PURE__ */ new Map(),
									optimisticOps: [],
									unsignaledParts: {}
								}), f.queries.query[o.query.index.name || ""] = d);
							}
							return Ro(p, d, c, l), p.promise.then(function(I) {
								return { result: Fr(I.result, o, f?.optimisticOps, r, p, u) };
							});
						}
					});
				}
			});
		}
	};
	function Wt(t, e) {
		return new Proxy(t, { get: function(n, r, i) {
			return r === "db" ? e : Reflect.get(n, r, i);
		} });
	}
	var vt = (function() {
		function t(e, n) {
			var r = this;
			this._middlewares = {}, this.verno = 0;
			var i = t.dependencies;
			this._options = n = V({
				addons: t.addons,
				autoOpen: !0,
				indexedDB: i.indexedDB,
				IDBKeyRange: i.IDBKeyRange,
				cache: "cloned"
			}, n), this._deps = {
				indexedDB: n.indexedDB,
				IDBKeyRange: n.IDBKeyRange
			};
			var o = n.addons;
			this._dbSchema = {}, this._versions = [], this._storeNames = [], this._allTables = {}, this.idbdb = null, this._novip = this;
			var a = {
				dbOpenError: null,
				isBeingOpened: !1,
				onReadyBeingFired: null,
				openComplete: !1,
				dbReadyResolve: W,
				dbReadyPromise: null,
				cancelOpen: W,
				openCanceller: null,
				autoSchema: !0,
				PR1398_maxLoop: 3,
				autoOpen: n.autoOpen
			};
			a.dbReadyPromise = new P(function(s) {
				a.dbReadyResolve = s;
			}), a.openCanceller = new P(function(s, c) {
				a.cancelOpen = c;
			}), this._state = a, this.name = e, this.on = ut(this, "populate", "blocked", "versionchange", "close", { ready: [rn, W] }), this.on.ready.subscribe = Yn(this.on.ready.subscribe, function(s) {
				return function(c, l) {
					t.vip(function() {
						var h = r._state;
						if (h.openComplete) h.dbOpenError || P.resolve().then(c), l && s(c);
						else if (h.onReadyBeingFired) h.onReadyBeingFired.push(c), l && s(c);
						else {
							s(c);
							var p = r;
							l || s(function b() {
								p.on.ready.unsubscribe(c), p.on.ready.unsubscribe(b);
							});
						}
					});
				};
			}), this.Collection = ji(this), this.Table = Di(this), this.Transaction = Yi(this), this.Version = fo(this), this.WhereClause = qi(this), this.on("versionchange", function(s) {
				s.newVersion > 0 ? console.warn("Another connection wants to upgrade database '".concat(r.name, "'. Closing db now to resume the upgrade.")) : console.warn("Another connection wants to delete database '".concat(r.name, "'. Closing db now to resume the delete request.")), r.close({ disableAutoOpen: !1 });
			}), this.on("blocked", function(s) {
				!s.newVersion || s.newVersion < s.oldVersion ? console.warn("Dexie.delete('".concat(r.name, "') was blocked")) : console.warn("Upgrade '".concat(r.name, "' blocked by other connection holding version ").concat(s.oldVersion / 10));
			}), this._maxKey = ht(n.IDBKeyRange), this._createTransaction = function(s, c, l, h) {
				return new r.Transaction(s, c, l, r._options.chromeTransactionDurability, h);
			}, this._fireOnBlocked = function(s) {
				r.on("blocked").fire(s), Ye.filter(function(c) {
					return c.name === r.name && c !== r && !c._state.vcFired;
				}).map(function(c) {
					return c.on("versionchange").fire(s);
				});
			}, this.use(ko), this.use(Fo), this.use(xo), this.use(_o), this.use(So);
			var u = new Proxy(this, { get: function(s, c, l) {
				if (c === "_vip") return !0;
				if (c === "table") return function(p) {
					return Wt(r.table(p), u);
				};
				var h = Reflect.get(s, c, l);
				return h instanceof gr ? Wt(h, u) : c === "tables" ? h.map(function(p) {
					return Wt(p, u);
				}) : c === "_createTransaction" ? function() {
					return Wt(h.apply(this, arguments), u);
				} : h;
			} });
			this.vip = u, o.forEach(function(s) {
				return s(r);
			});
		}
		return t.prototype.version = function(e) {
			if (isNaN(e) || e < .1) throw new K.Type("Given version is not a positive number");
			if (e = Math.round(e * 10) / 10, this.idbdb || this._state.isBeingOpened) throw new K.Schema("Cannot add version when database is open");
			this.verno = Math.max(this.verno, e);
			var n = this._versions, r = n.filter(function(i) {
				return i._cfg.version === e;
			})[0];
			return r || (r = new this.Version(e), n.push(r), n.sort(no), r.stores({}), this._state.autoSchema = !1, r);
		}, t.prototype._whenReady = function(e) {
			var n = this;
			return this.idbdb && (this._state.openComplete || B.letThrough || this._vip) ? e() : new P(function(r, i) {
				if (n._state.openComplete) return i(new K.DatabaseClosed(n._state.dbOpenError));
				if (!n._state.isBeingOpened) {
					if (!n._state.autoOpen) {
						i(new K.DatabaseClosed());
						return;
					}
					n.open().catch(W);
				}
				n._state.dbReadyPromise.then(r, i);
			}).then(e);
		}, t.prototype.use = function(e) {
			var n = e.stack, r = e.create, i = e.level, o = e.name;
			o && this.unuse({
				stack: n,
				name: o
			});
			var a = this._middlewares[n] || (this._middlewares[n] = []);
			return a.push({
				stack: n,
				create: r,
				level: i ?? 10,
				name: o
			}), a.sort(function(u, s) {
				return u.level - s.level;
			}), this;
		}, t.prototype.unuse = function(e) {
			var n = e.stack, r = e.name, i = e.create;
			return n && this._middlewares[n] && (this._middlewares[n] = this._middlewares[n].filter(function(o) {
				return i ? o.create !== i : r ? o.name !== r : !1;
			})), this;
		}, t.prototype.open = function() {
			var e = this;
			return Be(we, function() {
				return go(e);
			});
		}, t.prototype._close = function() {
			var e = this._state, n = Ye.indexOf(this);
			if (n >= 0 && Ye.splice(n, 1), this.idbdb) {
				try {
					this.idbdb.close();
				} catch {}
				this.idbdb = null;
			}
			e.isBeingOpened || (e.dbReadyPromise = new P(function(r) {
				e.dbReadyResolve = r;
			}), e.openCanceller = new P(function(r, i) {
				e.cancelOpen = i;
			}));
		}, t.prototype.close = function(e) {
			var n = (e === void 0 ? { disableAutoOpen: !0 } : e).disableAutoOpen, r = this._state;
			n ? (r.isBeingOpened && r.cancelOpen(new K.DatabaseClosed()), this._close(), r.autoOpen = !1, r.dbOpenError = new K.DatabaseClosed()) : (this._close(), r.autoOpen = this._options.autoOpen || r.isBeingOpened, r.openComplete = !1, r.dbOpenError = null);
		}, t.prototype.delete = function(e) {
			var n = this;
			e === void 0 && (e = { disableAutoOpen: !0 });
			var r = arguments.length > 0 && typeof arguments[0] != "object", i = this._state;
			return new P(function(o, a) {
				var u = function() {
					n.close(e);
					var s = n._deps.indexedDB.deleteDatabase(n.name);
					s.onsuccess = H(function() {
						vo(n._deps, n.name), o();
					}), s.onerror = he(a), s.onblocked = n._fireOnBlocked;
				};
				if (r) throw new K.InvalidArgument("Invalid closeOptions argument to db.delete()");
				i.isBeingOpened ? i.dbReadyPromise.then(u) : u();
			});
		}, t.prototype.backendDB = function() {
			return this.idbdb;
		}, t.prototype.isOpen = function() {
			return this.idbdb !== null;
		}, t.prototype.hasBeenClosed = function() {
			var e = this._state.dbOpenError;
			return e && e.name === "DatabaseClosed";
		}, t.prototype.hasFailed = function() {
			return this._state.dbOpenError !== null;
		}, t.prototype.dynamicallyOpened = function() {
			return this._state.autoSchema;
		}, Object.defineProperty(t.prototype, "tables", {
			get: function() {
				var e = this;
				return J(this._allTables).map(function(n) {
					return e._allTables[n];
				});
			},
			enumerable: !1,
			configurable: !0
		}), t.prototype.transaction = function() {
			var e = wo.apply(this, arguments);
			return this._transaction.apply(this, e);
		}, t.prototype._transaction = function(e, n, r) {
			var i = this, o = B.trans;
			(!o || o.db !== this || e.indexOf("!") !== -1) && (o = null);
			var a = e.indexOf("?") !== -1;
			e = e.replace("!", "").replace("?", "");
			var u, s;
			try {
				if (s = n.map(function(l) {
					var h = l instanceof i.Table ? l.name : l;
					if (typeof h != "string") throw new TypeError("Invalid table argument to Dexie.transaction(). Only Table or String are allowed");
					return h;
				}), e == "r" || e === mn) u = mn;
				else if (e == "rw" || e == yn) u = yn;
				else throw new K.InvalidArgument("Invalid transaction mode: " + e);
				if (o) {
					if (o.mode === mn && u === yn) if (a) o = null;
					else throw new K.SubTransaction("Cannot enter a sub-transaction with READWRITE mode when parent transaction is READONLY");
					o && s.forEach(function(l) {
						if (o && o.storeNames.indexOf(l) === -1) if (a) o = null;
						else throw new K.SubTransaction("Table " + l + " not included in parent transaction.");
					}), a && o && !o.active && (o = null);
				}
			} catch (l) {
				return o ? o._promise(null, function(h, p) {
					p(l);
				}) : G(l);
			}
			var c = Cr.bind(null, this, u, s, o, r);
			return o ? o._promise(u, c, "lock") : B.trans ? Be(B.transless, function() {
				return i._whenReady(c);
			}) : this._whenReady(c);
		}, t.prototype.table = function(e) {
			if (!re(this._allTables, e)) throw new K.InvalidTable("Table ".concat(e, " does not exist"));
			return this._allTables[e];
		}, t;
	})(), Ko = typeof Symbol < "u" && "observable" in Symbol ? Symbol.observable : "@@observable", Do = (function() {
		function t(e) {
			this._subscribe = e;
		}
		return t.prototype.subscribe = function(e, n, r) {
			return this._subscribe(!e || typeof e == "function" ? {
				next: e,
				error: n,
				complete: r
			} : e);
		}, t.prototype[Ko] = function() {
			return this;
		}, t;
	})(), Ut;
	try {
		Ut = {
			indexedDB: te.indexedDB || te.mozIndexedDB || te.webkitIndexedDB || te.msIndexedDB,
			IDBKeyRange: te.IDBKeyRange || te.webkitIDBKeyRange
		};
	} catch {
		Ut = {
			indexedDB: null,
			IDBKeyRange: null
		};
	}
	function Vo(t) {
		var e = !1, n, r = new Do(function(i) {
			var o = en(t);
			function a(I) {
				var m = He();
				try {
					o && Ge();
					var k = be(t, I);
					return o && (k = k.finally(_e)), k;
				} finally {
					m && qe();
				}
			}
			var u = !1, s, c = {}, l = {}, h = {
				get closed() {
					return u;
				},
				unsubscribe: function() {
					u || (u = !0, s && s.abort(), p && ke.storagemutated.unsubscribe(d));
				}
			};
			i.start && i.start(h);
			var p = !1, b = function() {
				return dn(g);
			};
			function f() {
				return Rn(l, c);
			}
			var d = function(I) {
				jt(c, I), f() && b();
			}, g = function() {
				if (!(u || !Ut.indexedDB)) {
					c = {};
					var I = {};
					s && s.abort(), s = new AbortController();
					var m = {
						subscr: I,
						signal: s.signal,
						requery: b,
						querier: t,
						trans: null
					}, k = a(m);
					Promise.resolve(k).then(function(x) {
						e = !0, n = x, !(u || m.signal.aborted) && (c = {}, l = I, !li(l) && !p && (ke(ft, d), p = !0), dn(function() {
							return !u && i.next && i.next(x);
						}));
					}, function(x) {
						e = !1, ["DatabaseClosedError", "AbortError"].includes(x?.name) || u || dn(function() {
							u || i.error && i.error(x);
						});
					});
				}
			};
			return setTimeout(b, 0), h;
		});
		return r.hasValue = function() {
			return e;
		}, r.getValue = function() {
			return n;
		}, r;
	}
	var Ve = vt;
	je(Ve, V(V({}, bt), {
		delete: function(t) {
			return new Ve(t, { addons: [] }).delete();
		},
		exists: function(t) {
			return new Ve(t, { addons: [] }).open().then(function(e) {
				return e.close(), !0;
			}).catch("NoSuchDatabaseError", function() {
				return !1;
			});
		},
		getDatabaseNames: function(t) {
			try {
				return ho(Ve.dependencies).then(t);
			} catch {
				return G(new K.MissingAPI());
			}
		},
		defineClass: function() {
			function t(e) {
				ie(this, e);
			}
			return t;
		},
		ignoreTransaction: function(t) {
			return B.trans ? Be(B.transless, t) : t();
		},
		vip: Cn,
		async: function(t) {
			return function() {
				try {
					var e = Dn(t.apply(this, arguments));
					return !e || typeof e.then != "function" ? P.resolve(e) : e;
				} catch (n) {
					return G(n);
				}
			};
		},
		spawn: function(t, e, n) {
			try {
				var r = Dn(t.apply(n, e || []));
				return !r || typeof r.then != "function" ? P.resolve(r) : r;
			} catch (i) {
				return G(i);
			}
		},
		currentTransaction: { get: function() {
			return B.trans || null;
		} },
		waitFor: function(t, e) {
			var n = P.resolve(typeof t == "function" ? Ve.ignoreTransaction(t) : t).timeout(e || 6e4);
			return B.trans ? B.trans.waitFor(n) : n;
		},
		Promise: P,
		debug: {
			get: function() {
				return fe;
			},
			set: function(t) {
				ir(t);
			}
		},
		derive: ze,
		extend: ie,
		props: je,
		override: Yn,
		Events: ut,
		on: ke,
		liveQuery: Vo,
		extendObservabilitySet: jt,
		getByKeyPath: pe,
		setByKeyPath: oe,
		delByKeyPath: si,
		shallowClone: Xn,
		deepClone: Me,
		getObjectDiff: Vn,
		cmp: L,
		asap: Qn,
		minKey: vn,
		addons: [],
		connections: Ye,
		errnames: nn,
		dependencies: Ut,
		cache: De,
		semVer: dr,
		version: dr.split(".").map(function(t) {
			return parseInt(t);
		}).reduce(function(t, e, n) {
			return t + e / Math.pow(10, n * 2);
		})
	})), Ve.maxKey = ht(Ve.dependencies.IDBKeyRange), typeof dispatchEvent < "u" && typeof addEventListener < "u" && (ke(ft, function(t) {
		if (!xe) {
			var e = new CustomEvent(_n, { detail: t });
			xe = !0, dispatchEvent(e), xe = !1;
		}
	}), addEventListener(_n, function(t) {
		var e = t.detail;
		xe || jn(e);
	}));
	function jn(t) {
		var e = xe;
		try {
			xe = !0, ke.storagemutated.fire(t), Kn(t, !0);
		} finally {
			xe = e;
		}
	}
	var xe = !1, Ae, zn = function() {};
	typeof BroadcastChannel < "u" && (zn = function() {
		Ae = new BroadcastChannel(_n), Ae.onmessage = function(t) {
			return t.data && jn(t.data);
		};
	}, zn(), typeof Ae.unref == "function" && Ae.unref(), ke(ft, function(t) {
		xe || Ae.postMessage(t);
	})), typeof addEventListener < "u" && (addEventListener("pagehide", function(t) {
		if (!vt.disableBfCache && t.persisted) {
			fe && console.debug("Dexie: handling persisted pagehide"), Ae?.close();
			for (var e = 0, n = Ye; e < n.length; e++) n[e].close({ disableAutoOpen: !1 });
		}
	}), addEventListener("pageshow", function(t) {
		!vt.disableBfCache && t.persisted && (fe && console.debug("Dexie: handling persisted pageshow"), zn(), jn({ all: new ne(-1 / 0, [[]]) }));
	})), P.rejectionMapper = mi, ir(fe);
	const No = "TavernKitchen_Memory", $o = 3, Je = new vt(No);
	Je.version($o).stores({
		meta: "chatId",
		chunks: "[chatId+chunkId], chatId, [chatId+floor]",
		chunkVectors: "[chatId+chunkId], chatId",
		eventVectors: "[chatId+eventId], chatId",
		stateVectors: "[chatId+atomId], chatId, [chatId+floor]"
	});
	const jo = Je.meta, zo = Je.chunks, Dr = Je.chunkVectors, Lo = Je.eventVectors, Wo = Je.stateVectors;
	function ce(t) {
		return t ? t instanceof Float32Array ? t : t instanceof ArrayBuffer ? new Float32Array(t) : ArrayBuffer.isView(t) ? new Float32Array(t.buffer, t.byteOffset, Math.floor(t.byteLength / 4)) : Array.isArray(t) ? new Float32Array(t) : null : null;
	}
	function Uo(t) {
		return t ? t instanceof ArrayBuffer ? t : ArrayBuffer.isView(t) ? t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength) : Array.isArray(t) ? new Float32Array(t).buffer : null : null;
	}
	function Ht(t, e) {
		const n = ce(t), r = ce(e);
		if (!n?.length || !r?.length || n.length !== r.length) return 0;
		let i = 0, o = 0, a = 0;
		for (let u = 0; u < n.length; u++) i += n[u] * r[u], o += n[u] * n[u], a += r[u] * r[u];
		return o && a ? i / (Math.sqrt(o) * Math.sqrt(a)) : 0;
	}
	function Ho(t = [], e) {
		const n = [], r = ce(e);
		if (!r?.length) return n;
		for (const i of t || []) i?.atomId && n.push({
			atomId: i.atomId,
			floor: i.floor,
			similarity: Ht(r, i.vector)
		});
		return n.sort((i, o) => o.similarity - i.similarity), n;
	}
	function qo(t = [], e) {
		const n = [], r = ce(e);
		if (!r?.length) return n;
		for (const i of t || []) i?.eventId && n.push({
			eventId: i.eventId,
			similarity: Ht(r, i.vector)
		});
		return n.sort((i, o) => o.similarity - i.similarity), n;
	}
	function Go(t = [], e = [], n) {
		const r = performance.now(), i = {
			requestedFloors: 0,
			chunkCount: t?.length || 0,
			vectorHits: 0,
			missingVectors: 0,
			chunkFetchTime: 0,
			vectorFetchTime: 0,
			deserializeTime: 0,
			scoreTime: 0,
			sortTime: 0,
			totalTime: 0,
			chunkCacheHits: 0,
			chunkCacheMisses: 0,
			vectorCacheHits: 0,
			vectorCacheMisses: 0,
			cacheFallbackDbTime: 0,
			cacheWarm: !0,
			backend: "runtime"
		}, o = [], a = ce(n);
		if (!a?.length || !t?.length) return i.totalTime = Math.round(performance.now() - r), {
			result: o,
			stats: i
		};
		const u = performance.now(), s = /* @__PURE__ */ new Map();
		for (const h of e || []) {
			if (!h?.chunkId) continue;
			const p = ce(h.vector);
			p?.length && s.set(h.chunkId, p);
		}
		i.deserializeTime = Math.round(performance.now() - u), i.vectorHits = s.size, i.missingVectors = Math.max(0, t.length - s.size);
		const c = performance.now();
		for (const h of t) {
			const p = s.get(h.chunkId);
			o.push({
				chunkId: h.chunkId,
				floor: h.floor,
				chunkIdx: h.chunkIdx,
				speaker: h.speaker,
				isUser: h.isUser,
				text: h.text,
				_cosineScore: p?.length ? Ht(a, p) : 0,
				_vectorPresent: !!p?.length
			});
		}
		i.scoreTime = Math.round(performance.now() - c);
		const l = performance.now();
		return o.sort((h, p) => {
			const b = Number(h.floor || 0) - Number(p.floor || 0);
			return b !== 0 ? b : p._cosineScore - h._cosineScore;
		}), i.sortTime = Math.round(performance.now() - l), i.totalTime = Math.round(performance.now() - r), {
			result: o,
			stats: i
		};
	}
	var Yo = Object.create, Vr = Object.defineProperty, Qo = Object.getOwnPropertyDescriptor, Xo = Object.getOwnPropertyNames, Jo = Object.getPrototypeOf, Zo = Object.prototype.hasOwnProperty, Ln = (t, e) => () => {
		try {
			return e || t((e = { exports: {} }).exports, e), e.exports;
		} catch (n) {
			throw e = 0, n;
		}
	}, ea = (t, e, n, r) => {
		if (e && typeof e == "object" || typeof e == "function") for (let i of Xo(e)) !Zo.call(t, i) && i !== n && Vr(t, i, {
			get: () => e[i],
			enumerable: !(r = Qo(e, i)) || r.enumerable
		});
		return t;
	}, ta = (t, e, n) => (n = t != null ? Yo(Jo(t)) : {}, ea(e || !t || !t.__esModule ? Vr(n, "default", {
		value: t,
		enumerable: !0
	}) : n, t)), na = Ln(() => {}), ra = Ln(() => {}), ia = ta(Ln((t, e) => {
		(function() {
			"use strict";
			var n = "input is invalid type", r = typeof window == "object", i = r ? window : {};
			i.JS_SHA256_NO_WINDOW && (r = !1);
			var o = !r && typeof self == "object", a = !i.JS_SHA256_NO_NODE_JS && !1;
			a ? i = globalThis : o && (i = self);
			var u = !i.JS_SHA256_NO_COMMON_JS && typeof e == "object" && e.exports, s = typeof define == "function" && define.amd, c = !i.JS_SHA256_NO_ARRAY_BUFFER && typeof ArrayBuffer < "u", l = "0123456789abcdef".split(""), h = [
				-2147483648,
				8388608,
				32768,
				128
			], p = [
				24,
				16,
				8,
				0
			], b = [
				1116352408,
				1899447441,
				3049323471,
				3921009573,
				961987163,
				1508970993,
				2453635748,
				2870763221,
				3624381080,
				310598401,
				607225278,
				1426881987,
				1925078388,
				2162078206,
				2614888103,
				3248222580,
				3835390401,
				4022224774,
				264347078,
				604807628,
				770255983,
				1249150122,
				1555081692,
				1996064986,
				2554220882,
				2821834349,
				2952996808,
				3210313671,
				3336571891,
				3584528711,
				113926993,
				338241895,
				666307205,
				773529912,
				1294757372,
				1396182291,
				1695183700,
				1986661051,
				2177026350,
				2456956037,
				2730485921,
				2820302411,
				3259730800,
				3345764771,
				3516065817,
				3600352804,
				4094571909,
				275423344,
				430227734,
				506948616,
				659060556,
				883997877,
				958139571,
				1322822218,
				1537002063,
				1747873779,
				1955562222,
				2024104815,
				2227730452,
				2361852424,
				2428436474,
				2756734187,
				3204031479,
				3329325298
			], f = [
				"hex",
				"array",
				"digest",
				"arrayBuffer"
			], d = [];
			(i.JS_SHA256_NO_NODE_JS || !Array.isArray) && (Array.isArray = function(y) {
				return Object.prototype.toString.call(y) === "[object Array]";
			}), c && (i.JS_SHA256_NO_ARRAY_BUFFER_IS_VIEW || !ArrayBuffer.isView) && (ArrayBuffer.isView = function(y) {
				return typeof y == "object" && y.buffer && y.buffer.constructor === ArrayBuffer;
			});
			var g = function(y, A) {
				return function(M) {
					return new S(A, !0).update(M)[y]();
				};
			}, I = function(y) {
				var A = g("hex", y);
				a && (A = m(A, y)), A.create = function() {
					return new S(y);
				}, A.update = function(_) {
					return A.create().update(_);
				};
				for (var M = 0; M < f.length; ++M) {
					var E = f[M];
					A[E] = g(E, y);
				}
				return A;
			}, m = function(y, A) {
				var M = na(), E = ra().Buffer, _ = A ? "sha224" : "sha256", v;
				E.from && !i.JS_SHA256_NO_BUFFER_FROM ? v = E.from : v = function(w) {
					return new E(w);
				};
				var C = function(w) {
					if (typeof w == "string") return M.createHash(_).update(w, "utf8").digest("hex");
					if (w == null) throw new Error(n);
					return w.constructor === ArrayBuffer && (w = new Uint8Array(w)), Array.isArray(w) || ArrayBuffer.isView(w) || w.constructor === E ? M.createHash(_).update(v(w)).digest("hex") : y(w);
				};
				return C;
			}, k = function(y, A) {
				return function(M, E) {
					return new T(M, A, !0).update(E)[y]();
				};
			}, x = function(y) {
				var A = k("hex", y);
				A.create = function(_) {
					return new T(_, y);
				}, A.update = function(_, v) {
					return A.create(_).update(v);
				};
				for (var M = 0; M < f.length; ++M) {
					var E = f[M];
					A[E] = k(E, y);
				}
				return A;
			};
			function S(y, A) {
				A ? (d[0] = d[16] = d[1] = d[2] = d[3] = d[4] = d[5] = d[6] = d[7] = d[8] = d[9] = d[10] = d[11] = d[12] = d[13] = d[14] = d[15] = 0, this.blocks = d) : this.blocks = [
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0
				], y ? (this.h0 = 3238371032, this.h1 = 914150663, this.h2 = 812702999, this.h3 = 4144912697, this.h4 = 4290775857, this.h5 = 1750603025, this.h6 = 1694076839, this.h7 = 3204075428) : (this.h0 = 1779033703, this.h1 = 3144134277, this.h2 = 1013904242, this.h3 = 2773480762, this.h4 = 1359893119, this.h5 = 2600822924, this.h6 = 528734635, this.h7 = 1541459225), this.block = this.start = this.bytes = this.hBytes = 0, this.finalized = this.hashed = !1, this.first = !0, this.is224 = y;
			}
			S.prototype.update = function(y) {
				if (!this.finalized) {
					var A, M = typeof y;
					if (M !== "string") {
						if (M === "object") {
							if (y === null) throw new Error(n);
							if (c && y.constructor === ArrayBuffer) y = new Uint8Array(y);
							else if (!Array.isArray(y) && (!c || !ArrayBuffer.isView(y))) throw new Error(n);
						} else throw new Error(n);
						A = !0;
					}
					for (var E, _ = 0, v, C = y.length, w = this.blocks; _ < C;) {
						if (this.hashed && (this.hashed = !1, w[0] = this.block, this.block = w[16] = w[1] = w[2] = w[3] = w[4] = w[5] = w[6] = w[7] = w[8] = w[9] = w[10] = w[11] = w[12] = w[13] = w[14] = w[15] = 0), A) for (v = this.start; _ < C && v < 64; ++_) w[v >>> 2] |= y[_] << p[v++ & 3];
						else for (v = this.start; _ < C && v < 64; ++_) E = y.charCodeAt(_), E < 128 ? w[v >>> 2] |= E << p[v++ & 3] : E < 2048 ? (w[v >>> 2] |= (192 | E >>> 6) << p[v++ & 3], w[v >>> 2] |= (128 | E & 63) << p[v++ & 3]) : E < 55296 || E >= 57344 ? (w[v >>> 2] |= (224 | E >>> 12) << p[v++ & 3], w[v >>> 2] |= (128 | E >>> 6 & 63) << p[v++ & 3], w[v >>> 2] |= (128 | E & 63) << p[v++ & 3]) : (E = 65536 + ((E & 1023) << 10 | y.charCodeAt(++_) & 1023), w[v >>> 2] |= (240 | E >>> 18) << p[v++ & 3], w[v >>> 2] |= (128 | E >>> 12 & 63) << p[v++ & 3], w[v >>> 2] |= (128 | E >>> 6 & 63) << p[v++ & 3], w[v >>> 2] |= (128 | E & 63) << p[v++ & 3]);
						this.lastByteIndex = v, this.bytes += v - this.start, v >= 64 ? (this.block = w[16], this.start = v - 64, this.hash(), this.hashed = !0) : this.start = v;
					}
					return this.bytes > 4294967295 && (this.hBytes += this.bytes / 4294967296 << 0, this.bytes = this.bytes % 4294967296), this;
				}
			}, S.prototype.finalize = function() {
				if (!this.finalized) {
					this.finalized = !0;
					var y = this.blocks, A = this.lastByteIndex;
					y[16] = this.block, y[A >>> 2] |= h[A & 3], this.block = y[16], A >= 56 && (this.hashed || this.hash(), y[0] = this.block, y[16] = y[1] = y[2] = y[3] = y[4] = y[5] = y[6] = y[7] = y[8] = y[9] = y[10] = y[11] = y[12] = y[13] = y[14] = y[15] = 0), y[14] = this.hBytes << 3 | this.bytes >>> 29, y[15] = this.bytes << 3, this.hash();
				}
			}, S.prototype.hash = function() {
				for (var y = this.h0, A = this.h1, M = this.h2, E = this.h3, _ = this.h4, v = this.h5, C = this.h6, w = this.h7, R = this.blocks, F = 16, N, $, z, D, U, Y, j, ue, mt, Yt; F < 64; ++F) D = R[F - 15], N = (D >>> 7 | D << 25) ^ (D >>> 18 | D << 14) ^ D >>> 3, D = R[F - 2], $ = (D >>> 17 | D << 15) ^ (D >>> 19 | D << 13) ^ D >>> 10, R[F] = R[F - 16] + N + R[F - 7] + $ << 0;
				for (Yt = A & M, F = 0; F < 64; F += 4) this.first ? (this.is224 ? (j = 300032, D = R[0] - 1413257819, w = D - 150054599 << 0, E = D + 24177077 << 0) : (j = 704751109, D = R[0] - 210244248, w = D - 1521486534 << 0, E = D + 143694565 << 0), this.first = !1) : (N = (y >>> 2 | y << 30) ^ (y >>> 13 | y << 19) ^ (y >>> 22 | y << 10), $ = (_ >>> 6 | _ << 26) ^ (_ >>> 11 | _ << 21) ^ (_ >>> 25 | _ << 7), j = y & A, z = j ^ y & M ^ Yt, Y = _ & v ^ ~_ & C, D = w + $ + Y + b[F] + R[F], U = N + z, w = E + D << 0, E = D + U << 0), N = (E >>> 2 | E << 30) ^ (E >>> 13 | E << 19) ^ (E >>> 22 | E << 10), $ = (w >>> 6 | w << 26) ^ (w >>> 11 | w << 21) ^ (w >>> 25 | w << 7), ue = E & y, z = ue ^ E & A ^ j, Y = w & _ ^ ~w & v, D = C + $ + Y + b[F + 1] + R[F + 1], U = N + z, C = M + D << 0, M = D + U << 0, N = (M >>> 2 | M << 30) ^ (M >>> 13 | M << 19) ^ (M >>> 22 | M << 10), $ = (C >>> 6 | C << 26) ^ (C >>> 11 | C << 21) ^ (C >>> 25 | C << 7), mt = M & E, z = mt ^ M & y ^ ue, Y = C & w ^ ~C & _, D = v + $ + Y + b[F + 2] + R[F + 2], U = N + z, v = A + D << 0, A = D + U << 0, N = (A >>> 2 | A << 30) ^ (A >>> 13 | A << 19) ^ (A >>> 22 | A << 10), $ = (v >>> 6 | v << 26) ^ (v >>> 11 | v << 21) ^ (v >>> 25 | v << 7), Yt = A & M, z = Yt ^ A & E ^ mt, Y = v & C ^ ~v & w, D = _ + $ + Y + b[F + 3] + R[F + 3], U = N + z, _ = y + D << 0, y = D + U << 0, this.chromeBugWorkAround = !0;
				this.h0 = this.h0 + y << 0, this.h1 = this.h1 + A << 0, this.h2 = this.h2 + M << 0, this.h3 = this.h3 + E << 0, this.h4 = this.h4 + _ << 0, this.h5 = this.h5 + v << 0, this.h6 = this.h6 + C << 0, this.h7 = this.h7 + w << 0;
			}, S.prototype.hex = function() {
				this.finalize();
				var y = this.h0, A = this.h1, M = this.h2, E = this.h3, _ = this.h4, v = this.h5, C = this.h6, w = this.h7, R = l[y >>> 28 & 15] + l[y >>> 24 & 15] + l[y >>> 20 & 15] + l[y >>> 16 & 15] + l[y >>> 12 & 15] + l[y >>> 8 & 15] + l[y >>> 4 & 15] + l[y & 15] + l[A >>> 28 & 15] + l[A >>> 24 & 15] + l[A >>> 20 & 15] + l[A >>> 16 & 15] + l[A >>> 12 & 15] + l[A >>> 8 & 15] + l[A >>> 4 & 15] + l[A & 15] + l[M >>> 28 & 15] + l[M >>> 24 & 15] + l[M >>> 20 & 15] + l[M >>> 16 & 15] + l[M >>> 12 & 15] + l[M >>> 8 & 15] + l[M >>> 4 & 15] + l[M & 15] + l[E >>> 28 & 15] + l[E >>> 24 & 15] + l[E >>> 20 & 15] + l[E >>> 16 & 15] + l[E >>> 12 & 15] + l[E >>> 8 & 15] + l[E >>> 4 & 15] + l[E & 15] + l[_ >>> 28 & 15] + l[_ >>> 24 & 15] + l[_ >>> 20 & 15] + l[_ >>> 16 & 15] + l[_ >>> 12 & 15] + l[_ >>> 8 & 15] + l[_ >>> 4 & 15] + l[_ & 15] + l[v >>> 28 & 15] + l[v >>> 24 & 15] + l[v >>> 20 & 15] + l[v >>> 16 & 15] + l[v >>> 12 & 15] + l[v >>> 8 & 15] + l[v >>> 4 & 15] + l[v & 15] + l[C >>> 28 & 15] + l[C >>> 24 & 15] + l[C >>> 20 & 15] + l[C >>> 16 & 15] + l[C >>> 12 & 15] + l[C >>> 8 & 15] + l[C >>> 4 & 15] + l[C & 15];
				return this.is224 || (R += l[w >>> 28 & 15] + l[w >>> 24 & 15] + l[w >>> 20 & 15] + l[w >>> 16 & 15] + l[w >>> 12 & 15] + l[w >>> 8 & 15] + l[w >>> 4 & 15] + l[w & 15]), R;
			}, S.prototype.toString = S.prototype.hex, S.prototype.digest = function() {
				this.finalize();
				var y = this.h0, A = this.h1, M = this.h2, E = this.h3, _ = this.h4, v = this.h5, C = this.h6, w = this.h7, R = [
					y >>> 24 & 255,
					y >>> 16 & 255,
					y >>> 8 & 255,
					y & 255,
					A >>> 24 & 255,
					A >>> 16 & 255,
					A >>> 8 & 255,
					A & 255,
					M >>> 24 & 255,
					M >>> 16 & 255,
					M >>> 8 & 255,
					M & 255,
					E >>> 24 & 255,
					E >>> 16 & 255,
					E >>> 8 & 255,
					E & 255,
					_ >>> 24 & 255,
					_ >>> 16 & 255,
					_ >>> 8 & 255,
					_ & 255,
					v >>> 24 & 255,
					v >>> 16 & 255,
					v >>> 8 & 255,
					v & 255,
					C >>> 24 & 255,
					C >>> 16 & 255,
					C >>> 8 & 255,
					C & 255
				];
				return this.is224 || R.push(w >>> 24 & 255, w >>> 16 & 255, w >>> 8 & 255, w & 255), R;
			}, S.prototype.array = S.prototype.digest, S.prototype.arrayBuffer = function() {
				this.finalize();
				var y = /* @__PURE__ */ new ArrayBuffer(this.is224 ? 28 : 32), A = new DataView(y);
				return A.setUint32(0, this.h0), A.setUint32(4, this.h1), A.setUint32(8, this.h2), A.setUint32(12, this.h3), A.setUint32(16, this.h4), A.setUint32(20, this.h5), A.setUint32(24, this.h6), this.is224 || A.setUint32(28, this.h7), y;
			};
			function T(y, A, M) {
				var E, _ = typeof y;
				if (_ === "string") {
					var v = [], C = y.length, w = 0, R;
					for (E = 0; E < C; ++E) R = y.charCodeAt(E), R < 128 ? v[w++] = R : R < 2048 ? (v[w++] = 192 | R >>> 6, v[w++] = 128 | R & 63) : R < 55296 || R >= 57344 ? (v[w++] = 224 | R >>> 12, v[w++] = 128 | R >>> 6 & 63, v[w++] = 128 | R & 63) : (R = 65536 + ((R & 1023) << 10 | y.charCodeAt(++E) & 1023), v[w++] = 240 | R >>> 18, v[w++] = 128 | R >>> 12 & 63, v[w++] = 128 | R >>> 6 & 63, v[w++] = 128 | R & 63);
					y = v;
				} else if (_ === "object") {
					if (y === null) throw new Error(n);
					if (c && y.constructor === ArrayBuffer) y = new Uint8Array(y);
					else if (!Array.isArray(y) && (!c || !ArrayBuffer.isView(y))) throw new Error(n);
				} else throw new Error(n);
				y.length > 64 && (y = new S(A, !0).update(y).array());
				var F = [], N = [];
				for (E = 0; E < 64; ++E) {
					var $ = y[E] || 0;
					F[E] = 92 ^ $, N[E] = 54 ^ $;
				}
				S.call(this, A, M), this.update(N), this.oKeyPad = F, this.inner = !0, this.sharedMemory = M;
			}
			T.prototype = new S(), T.prototype.finalize = function() {
				if (S.prototype.finalize.call(this), this.inner) {
					this.inner = !1;
					var y = this.array();
					S.call(this, this.is224, this.sharedMemory), this.update(this.oKeyPad), this.update(y), S.prototype.finalize.call(this);
				}
			};
			var O = I();
			O.sha256 = O, O.sha224 = I(!0), O.sha256.hmac = x(), O.sha224.hmac = x(!0), u ? e.exports = O : (i.sha256 = O.sha256, i.sha224 = O.sha224, s && define(function() {
				return O;
			}));
		})();
	})(), 1).sha256;
	function oa(t, e) {
		return ia(JSON.stringify([t, e]));
	}
	const Wn = (t) => String(t || "").normalize("NFKC").toLowerCase();
	function aa(t, e, { queryVector: n, queryTerms: r = [], fingerprint: i, limit: o = 40 } = {}) {
		const a = [...new Set(r.map(Wn).filter((f) => f.trim().length >= 2))].slice(0, 48), u = new Map(e.map((f) => [f.chunkId, f])), s = t.map((f) => {
			const d = oa("chunk", f.text), g = u.get(f.chunkId);
			let I = null;
			try {
				const x = g?.fingerprint === i && g?.sourceHash === d ? ce(g.vector) : null;
				n?.length && x?.length === n.length && (g.dims == null || g.dims === x.length) && Array.from(x).every(Number.isFinite) && x.some((S) => S !== 0) && (I = x);
			} catch {
				I = null;
			}
			const m = Wn(f.text), k = Wn((f.tags || []).join(" "));
			return {
				...f,
				sourceHash: d,
				_vectorPresent: !!I,
				_cosineScore: I ? Ht(n, I) : 0,
				_terms: a.filter((x) => m.includes(x) || k.includes(x))
			};
		}), c = new Map(a.map((f) => [f, s.filter((d) => d._terms.includes(f)).length]));
		for (const f of s) f._lexicalScore = f._terms.reduce((d, g) => d + Math.log(1 + s.length / (1 + c.get(g))), 0);
		const l = (f, d) => f.floor - d.floor || f.chunkIdx - d.chunkIdx, h = s.filter((f) => f._vectorPresent && f._cosineScore >= .35).sort((f, d) => d._cosineScore - f._cosineScore || l(f, d)).slice(0, o), p = s.filter((f) => f._lexicalScore > 0).sort((f, d) => d._lexicalScore - f._lexicalScore || l(f, d)).slice(0, o), b = /* @__PURE__ */ new Map();
		for (const f of [h, p]) f.forEach((d, g) => {
			const I = b.get(d.chunkId) || {
				...d,
				_score: 0
			};
			I._score += 1 / (60 + g + 1), b.set(d.chunkId, I);
		});
		return {
			chunks: [...b.values()].sort((f, d) => d._score - f._score || l(f, d)).slice(0, o).map(({ _terms: f, tags: d, ...g }) => g),
			stats: {
				documents: s.length,
				usableVectors: s.filter((f) => f._vectorPresent).length,
				denseHits: h.length,
				lexicalHits: p.length,
				candidates: b.size
			}
		};
	}
	async function sa(t, e, n) {
		const i = aa(e, n.queryVector?.length ? await Dr.where("chatId").equals(t).toArray() : [], n);
		return {
			...i,
			stats: {
				...i.stats,
				chatId: t,
				owner: "raw-source",
				cacheMode: "none",
				status: "raw-read-complete",
				chunks: e.length,
				chunkVectors: i.stats.usableVectors
			}
		};
	}
	const Un = "diffusion", Nr = { info() {} }, Q = {
		ALPHA: .15,
		EPSILON: 1e-5,
		MAX_ITER: 50,
		GAMMA: {
			what: .4,
			rSem: .4,
			who: .1,
			where: .05,
			time: .05
		},
		R_SEM_MIN_SIM: .62,
		R_SEM_TOPK: 8,
		TIME_WINDOW_MAX: 80,
		TIME_DECAY_DIVISOR: 12,
		WHERE_MAX_GROUP_SIZE: 16,
		WHERE_FREQ_DAMP_PIVOT: 6,
		WHERE_FREQ_DAMP_MIN: .2,
		COSINE_GATE: .46,
		SCORE_FLOOR: .1,
		DIFFUSION_CAP: 100
	};
	function Ze(t) {
		return String(t || "").normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
	}
	function $r(t, e) {
		if (!t?.length || !e?.length || t.length !== e.length) return 0;
		let n = 0, r = 0, i = 0;
		for (let o = 0; o < t.length; o++) n += t[o] * e[o], r += t[o] * t[o], i += e[o] * e[o];
		return r && i ? n / (Math.sqrt(r) * Math.sqrt(i)) : 0;
	}
	function ua(t, e = /* @__PURE__ */ new Set()) {
		const n = /* @__PURE__ */ new Set();
		for (const r of t.edges || []) {
			const i = Ze(r?.s), o = Ze(r?.t);
			i && !e.has(i) && n.add(i), o && !e.has(o) && n.add(o);
		}
		return n;
	}
	function ca(t, e = /* @__PURE__ */ new Set()) {
		const n = /* @__PURE__ */ new Set();
		for (const r of t.edges || []) {
			const i = Ze(r?.s), o = Ze(r?.t);
			if (i && o && !e.has(i) && !e.has(o)) {
				const a = [i, o].sort().join("↔");
				n.add(a);
			}
		}
		return n;
	}
	function la(t) {
		return Ze(t.where);
	}
	function fa(t, e) {
		const n = Number(t?.floor || 0), r = Number(e?.floor || 0);
		return Math.abs(n - r);
	}
	function ha(t) {
		return Math.exp(-t / Q.TIME_DECAY_DIVISOR);
	}
	function da(t, e) {
		if (!t.size || !e.size) return 0;
		let n = 0;
		const [r, i] = t.size <= e.size ? [t, e] : [e, t];
		for (const a of r) i.has(a) && n++;
		const o = t.size + e.size - n;
		return o > 0 ? n / o : 0;
	}
	function pa(t, e) {
		if (!t.size || !e.size) return 0;
		let n = 0;
		const [r, i] = t.size <= e.size ? [t, e] : [e, t];
		for (const o of r) i.has(o) && n++;
		return n / r.size;
	}
	function va(t, e = /* @__PURE__ */ new Set()) {
		return t.map((n) => ({
			entities: ua(n, e),
			interactionPairs: ca(n, e),
			location: la(n)
		}));
	}
	function ma(t) {
		const e = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map();
		for (let r = 0; r < t.length; r++) {
			for (const o of t[r].interactionPairs) e.has(o) || e.set(o, []), e.get(o).push(r);
			const i = t[r].location;
			i && n.set(i, (n.get(i) || 0) + 1);
		}
		return {
			whatIndex: e,
			locationFreq: n
		};
	}
	function ya(t, e, n, r) {
		let i = 0;
		for (const o of t.values()) {
			const a = o.map((s) => ({
				idx: s,
				floor: Number(r[s]?.floor || 0)
			})).sort((s, c) => s.floor - c.floor), u = [];
			for (let s = 0; s < a.length; s++) for (let c = s + 1; c < a.length && !(a[c].floor - a[s].floor > Q.TIME_WINDOW_MAX); c++) {
				const l = Math.min(a[s].idx, a[c].idx), h = Math.max(a[s].idx, a[c].idx);
				u.push(l * n + h);
			}
			i += o.length * (o.length - 1) / 2 - u.length, u.sort((s, c) => s - c);
			for (const s of u) e.add(s);
		}
		return i;
	}
	function ga(t, e = [], n = /* @__PURE__ */ new Set(), r = Nr) {
		const i = t.length, o = performance.now(), a = va(t, n), { whatIndex: u, locationFreq: s } = ma(a), c = /* @__PURE__ */ new Set(), l = /* @__PURE__ */ new Set(), h = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Set(), b = ya(u, c, i, t), f = new Map((e || []).filter((v) => v?.atomId && v?.rVector?.length).map((v) => [v.atomId, v.rVector])), d = t.map((v) => f.get(v.atomId) || null), g = Array.from({ length: i }, () => []);
		let I = 0, m = 0, k = 0;
		const x = t.map((v, C) => ({
			idx: C,
			floor: Number(v?.floor || 0)
		})).sort((v, C) => v.floor - C.floor);
		for (let v = 0; v < x.length; v++) {
			const C = x[v].idx, w = x[v].floor;
			for (let R = v + 1; R < x.length && !(x[R].floor - w > Q.TIME_WINDOW_MAX); R++) {
				const F = x[R].idx, N = d[C], $ = d[F];
				if (!N?.length || !$?.length) continue;
				const z = $r(N, $);
				z < Q.R_SEM_MIN_SIM || (g[C].push({
					target: F,
					sim: z
				}), g[F].push({
					target: C,
					sim: z
				}), I += z, m++);
			}
		}
		for (let v = 0; v < i; v++) {
			const C = g[v];
			if (C.length) {
				C.sort((w, R) => R.sim - w.sim), C.length > Q.R_SEM_TOPK && (k += C.length - Q.R_SEM_TOPK);
				for (const w of C.slice(0, Q.R_SEM_TOPK)) {
					const R = Math.min(v, w.target), F = Math.max(v, w.target), N = R * i + F;
					l.add(N);
					const $ = h.get(N) || 0;
					w.sim > $ && h.set(N, w.sim);
				}
			}
		}
		for (const v of c) p.add(v);
		for (const v of l) p.add(v);
		const S = Array.from({ length: i }, () => []);
		let T = 0;
		const O = {
			what: 0,
			where: 0,
			rSem: 0,
			who: 0
		};
		let y = 0, A = 0;
		for (const v of p) {
			const C = Math.floor(v / i), w = v % i, R = ha(fa(t[C], t[w])), F = a[C], N = a[w], $ = pa(F.interactionPairs, N.interactionPairs), z = h.get(v) || 0, D = da(F.entities, N.entities);
			let U = 0;
			if (F.location && F.location === N.location) {
				const j = s.get(F.location) || 1;
				U = Math.max(Q.WHERE_FREQ_DAMP_MIN, Math.min(1, Q.WHERE_FREQ_DAMP_PIVOT / Math.max(1, j)));
			}
			const Y = Q.GAMMA.what * $ + Q.GAMMA.rSem * z + Q.GAMMA.who * D + Q.GAMMA.where * U + Q.GAMMA.time * R;
			Y > 0 && (S[C].push({
				target: w,
				weight: Y
			}), S[w].push({
				target: C,
				weight: Y
			}), T++, $ > 0 && O.what++, z > 0 && O.rSem++, D > 0 && O.who++, U > 0 && O.where++, D > 0 && y++, U > 0 && A++);
		}
		const M = Math.round(performance.now() - o);
		r.info(Un, `Graph: ${i} nodes, ${T} edges (candidate_by_what=${c.size} candidate_by_r_sem=${l.size}) (what=${O.what} r_sem=${O.rSem} who=${O.who} where=${O.where}) (reweight_who_used=${y} reweight_where_used=${A}) (what_window_skipped_occurrences=${b} topk_pruned=${k}) (${M}ms)`);
		const E = i > 1 ? i * (i - 1) / 2 : 0, _ = E > 0 ? Number((T / E * 100).toFixed(2)) : 0;
		return {
			neighbors: S,
			edgeCount: T,
			channelStats: O,
			buildTime: M,
			candidatePairs: p.size,
			pairsFromWhat: c.size,
			pairsFromRSem: l.size,
			rSemAvgSim: m ? Number((I / m).toFixed(3)) : 0,
			whatWindowSkippedOccurrences: b,
			topKPrunedPairs: k,
			reweightWhoUsed: y,
			reweightWhereUsed: A,
			edgeDensity: _
		};
	}
	function wa(t, e, n) {
		const r = new Float64Array(n);
		let i = 0;
		for (const o of t) {
			const a = e.get(o.atomId);
			if (a == null) continue;
			const u = Math.max(0, o.rerankScore || o.similarity || 0);
			r[a] += u, i += u;
		}
		if (i > 0) for (let o = 0; o < n; o++) r[o] /= i;
		return r;
	}
	function ba(t, e) {
		const n = Array.from({ length: e }, () => []), r = [];
		for (let i = 0; i < e; i++) {
			const o = t[i];
			let a = 0;
			for (let s = 0; s < o.length; s++) a += o[s].weight;
			if (a <= 0) {
				r.push(i);
				continue;
			}
			const u = n[i];
			for (let s = 0; s < o.length; s++) u.push({
				target: o[s].target,
				prob: o[s].weight / a
			});
		}
		return {
			columns: n,
			dangling: r
		};
	}
	function _a(t, e, n, r) {
		const i = Q.ALPHA, o = 1 - i, a = Q.EPSILON, u = Q.MAX_ITER;
		let s = new Float64Array(r);
		for (let h = 0; h < r; h++) s[h] = e[h];
		let c = 0, l = 0;
		for (let h = 0; h < u; h++) {
			const p = new Float64Array(r);
			let b = 0;
			for (let g = 0; g < n.length; g++) b += s[n[g]];
			for (let g = 0; g < r; g++) {
				const I = s[g];
				if (I === 0) continue;
				const m = t[g], k = o * I;
				for (let x = 0; x < m.length; x++) p[m[x].target] += k * m[x].prob;
			}
			const f = i + o * b;
			for (let g = 0; g < r; g++) p[g] += f * e[g];
			let d = 0;
			for (let g = 0; g < r; g++) d += Math.abs(p[g] - s[g]);
			if (s = p, c = h + 1, l = d, d < a) break;
		}
		return {
			pi: s,
			iterations: c,
			finalError: l
		};
	}
	function Sa(t, e, n, r, i, o) {
		const a = e.length, u = {
			passed: 0,
			filtered: 0,
			noVector: 0
		};
		let s = 0;
		for (let l = 0; l < a; l++) t[l] > 0 && !r.has(e[l]) && t[l] > s && (s = t[l]);
		if (s <= 0) return {
			diffused: [],
			gateStats: u
		};
		const c = [];
		for (let l = 0; l < a; l++) {
			const h = e[l];
			if (r.has(h) || t[l] <= 0) continue;
			const p = i.get(h);
			if (!p?.length) {
				u.noVector++;
				continue;
			}
			const b = $r(o, p);
			if (b < Q.COSINE_GATE) {
				u.filtered++;
				continue;
			}
			const f = t[l] / s, d = f * b;
			if (d < Q.SCORE_FLOOR) {
				u.filtered++;
				continue;
			}
			u.passed++;
			const g = n.get(h);
			g && c.push({
				atomId: h,
				floor: g.floor,
				atom: g,
				finalScore: d,
				pprScore: t[l],
				pprNormalized: f,
				cosine: b
			});
		}
		return c.sort((l, h) => h.finalScore - l.finalScore), {
			diffused: c.slice(0, Q.DIFFUSION_CAP),
			gateStats: u
		};
	}
	function Ia(t, e, n, r, i, o = {}) {
		const a = performance.now(), u = o?.logger || Nr;
		if (!t?.length || !e?.length || !r?.length) return jr(i), [];
		const { name1: s } = o || {}, c = /* @__PURE__ */ new Set();
		s && c.add(Ze(s));
		const l = performance.now(), h = /* @__PURE__ */ new Map(), p = [], b = /* @__PURE__ */ new Map();
		for (let j = 0; j < e.length; j++) {
			const ue = e[j];
			h.set(ue.atomId, ue), p.push(ue.atomId), b.set(ue.atomId, j);
		}
		const f = e.length, d = Math.round(performance.now() - l), g = t.filter((j) => b.has(j.atomId)), I = new Set(g.map((j) => j.atomId));
		if (!g.length) return jr(i), [];
		const m = ga(e, n, c, u);
		if (m.edgeCount === 0) return zr(i, {
			seedCount: g.length,
			graphNodes: f,
			graphEdges: 0,
			channelStats: m.channelStats,
			candidatePairs: m.candidatePairs,
			pairsFromWhat: m.pairsFromWhat,
			pairsFromRSem: m.pairsFromRSem,
			rSemAvgSim: m.rSemAvgSim,
			whatWindowSkippedOccurrences: m.whatWindowSkippedOccurrences,
			topKPrunedPairs: m.topKPrunedPairs,
			edgeDensity: m.edgeDensity,
			reweightWhoUsed: m.reweightWhoUsed,
			reweightWhereUsed: m.reweightWhereUsed,
			indexTime: d,
			time: m.buildTime
		}), u.info(Un, "No graph edges - skipping diffusion"), [];
		const k = performance.now(), x = wa(g, b, f), S = Math.round(performance.now() - k), T = performance.now(), { columns: O, dangling: y } = ba(m.neighbors, f), A = Math.round(performance.now() - T), M = performance.now(), { pi: E, iterations: _, finalError: v } = _a(O, x, y, f), C = Math.round(performance.now() - M);
		let w = 0;
		for (let j = 0; j < f; j++) E[j] > 0 && !I.has(p[j]) && w++;
		const R = performance.now(), F = /* @__PURE__ */ new Map();
		for (const j of n || []) F.set(j.atomId, j.vector);
		const N = Math.round(performance.now() - R), $ = performance.now(), { diffused: z, gateStats: D } = Sa(E, p, h, I, F, r), U = Math.round(performance.now() - $), Y = Math.round(performance.now() - a);
		return zr(i, {
			seedCount: g.length,
			graphNodes: f,
			graphEdges: m.edgeCount,
			channelStats: m.channelStats,
			candidatePairs: m.candidatePairs,
			pairsFromWhat: m.pairsFromWhat,
			pairsFromRSem: m.pairsFromRSem,
			rSemAvgSim: m.rSemAvgSim,
			whatWindowSkippedOccurrences: m.whatWindowSkippedOccurrences,
			topKPrunedPairs: m.topKPrunedPairs,
			edgeDensity: m.edgeDensity,
			reweightWhoUsed: m.reweightWhoUsed,
			reweightWhereUsed: m.reweightWhereUsed,
			indexTime: d,
			buildTime: m.buildTime,
			seedVectorTime: S,
			normalizeTime: A,
			iterations: _,
			convergenceError: v,
			pprTime: C,
			pprActivated: w,
			cosineGatePassed: D.passed,
			cosineGateFiltered: D.filtered,
			cosineGateNoVector: D.noVector,
			vectorMapTime: N,
			postVerifyTime: U,
			postGatePassRate: w > 0 ? Math.round(D.passed / w * 100) : 0,
			finalCount: z.length,
			scoreDistribution: z.length > 0 ? ka(z.map((j) => j.finalScore)) : {
				min: 0,
				max: 0,
				mean: 0
			},
			time: Y
		}), u.info(Un, `Diffusion: ${g.length} seeds → graph(${f}n/${m.edgeCount}e) → PPR(${_}it, ε=${v.toExponential(1)}, ${C}ms) → ${w} activated → gate(${D.passed}✓/${D.filtered}✗${D.noVector ? `/${D.noVector}?` : ""}) → ${z.length} final (index=${d}ms graph=${m.buildTime}ms seed=${S}ms normalize=${A}ms ppr=${C}ms vectorMap=${N}ms post=${U}ms total=${Y}ms)`), z;
	}
	function ka(t) {
		if (!t.length) return {
			min: 0,
			max: 0,
			mean: 0
		};
		const e = [...t].sort((r, i) => r - i), n = e.reduce((r, i) => r + i, 0);
		return {
			min: Number(e[0].toFixed(3)),
			max: Number(e[e.length - 1].toFixed(3)),
			mean: Number((n / e.length).toFixed(3))
		};
	}
	function jr(t) {
		t && (t.diffusion = {
			seedCount: 0,
			graphNodes: 0,
			graphEdges: 0,
			iterations: 0,
			convergenceError: 0,
			pprActivated: 0,
			cosineGatePassed: 0,
			cosineGateFiltered: 0,
			cosineGateNoVector: 0,
			finalCount: 0,
			scoreDistribution: {
				min: 0,
				max: 0,
				mean: 0
			},
			byChannel: {
				what: 0,
				where: 0,
				rSem: 0,
				who: 0
			},
			candidatePairs: 0,
			pairsFromWhat: 0,
			pairsFromRSem: 0,
			rSemAvgSim: 0,
			whatWindowSkippedOccurrences: 0,
			topKPrunedPairs: 0,
			edgeDensity: 0,
			reweightWhoUsed: 0,
			reweightWhereUsed: 0,
			indexTime: 0,
			buildTime: 0,
			seedVectorTime: 0,
			normalizeTime: 0,
			pprTime: 0,
			vectorMapTime: 0,
			postVerifyTime: 0,
			postGatePassRate: 0,
			time: 0
		});
	}
	function zr(t, e) {
		t && (t.diffusion = {
			seedCount: e.seedCount || 0,
			graphNodes: e.graphNodes || 0,
			graphEdges: e.graphEdges || 0,
			iterations: e.iterations || 0,
			convergenceError: e.convergenceError || 0,
			pprActivated: e.pprActivated || 0,
			cosineGatePassed: e.cosineGatePassed || 0,
			cosineGateFiltered: e.cosineGateFiltered || 0,
			cosineGateNoVector: e.cosineGateNoVector || 0,
			postGatePassRate: e.postGatePassRate || 0,
			finalCount: e.finalCount || 0,
			scoreDistribution: e.scoreDistribution || {
				min: 0,
				max: 0,
				mean: 0
			},
			byChannel: e.channelStats || {
				what: 0,
				where: 0,
				rSem: 0,
				who: 0
			},
			candidatePairs: e.candidatePairs || 0,
			pairsFromWhat: e.pairsFromWhat || 0,
			pairsFromRSem: e.pairsFromRSem || 0,
			rSemAvgSim: e.rSemAvgSim || 0,
			whatWindowSkippedOccurrences: e.whatWindowSkippedOccurrences || 0,
			topKPrunedPairs: e.topKPrunedPairs || 0,
			edgeDensity: e.edgeDensity || 0,
			reweightWhoUsed: e.reweightWhoUsed || 0,
			reweightWhereUsed: e.reweightWhereUsed || 0,
			indexTime: e.indexTime || 0,
			buildTime: e.buildTime || 0,
			seedVectorTime: e.seedVectorTime || 0,
			normalizeTime: e.normalizeTime || 0,
			pprTime: e.pprTime || 0,
			vectorMapTime: e.vectorMapTime || 0,
			postVerifyTime: e.postVerifyTime || 0,
			time: e.time || 0
		});
	}
	const xa = Object.freeze({
		maxProtectedEvents: 5,
		maxCandidateShare: .4,
		maxEvidenceBudgetShare: .4
	});
	function Lr(t) {
		return String(t || "").replace(/\s+/g, "").replace(/：/g, ":");
	}
	function Aa(t) {
		const e = String(t || "").match(/\(#(\d+)(?:-(\d+))?\)/);
		return e ? {
			start: Math.max(0, Number(e[1]) - 1),
			end: Math.max(0, Number(e[2] || e[1]) - 1)
		} : null;
	}
	function Ea(t, e) {
		const n = Math.max(0, Math.floor(Number(t) || 0)), r = Number(e);
		return Math.floor(n * (Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0));
	}
	function Ma(t, e) {
		return e?.marker ? e.querySpeaker === "user" ? t?.isUser === !0 && (e.userFloors || []).includes(t.floor) : e.querySpeaker === "assistant" ? t?.isUser !== !0 && (e.assistantFloors || []).includes(t.floor) : Lr(t?.text).includes(Lr(e.marker)) : !1;
	}
	const le = Object.freeze({
		perLane: 3,
		shortlistPerSource: 32,
		minSimilarity: .5,
		lambda: .85,
		rrfK: 60,
		admissionBatchSize: 3
	});
	function Wr(t) {
		const e = ce(t);
		if (!e?.length) return null;
		let n = 0;
		for (const o of e) {
			if (!Number.isFinite(o)) return null;
			n += o * o;
		}
		if (!n) return null;
		const r = Math.sqrt(n), i = new Float32Array(e.length);
		for (let o = 0; o < e.length; o++) i[o] = e[o] / r;
		return i;
	}
	function Ur(t, e) {
		if (!t || !e || t.length !== e.length) return 0;
		let n = 0;
		for (let r = 0; r < t.length; r++) n += t[r] * e[r];
		return n;
	}
	function Ne(t, e) {
		return t.sort((n, r) => e(r) - e(n) || n.chunk.floor - r.chunk.floor || n.chunk.chunkIdx - r.chunk.chunkIdx);
	}
	function Ta(t) {
		const e = le, n = Ne(t.filter((i) => i.queryScore >= e.minSimilarity), (i) => i.queryScore), r = Ne(t.filter((i) => i.lexicalScore > 0), (i) => i.lexicalScore);
		for (const i of [n, r]) for (const [o, a] of i.entries()) a.conversationScore += (e.rrfK + 1) / (e.rrfK + o + 1) / 2;
		return {
			queryRows: n,
			conversationRows: Ne(t.filter((i) => i.conversationScore > 0), (i) => i.conversationScore),
			lexicalRows: r,
			temporalRows: t.filter((i) => i.temporal).sort((i, o) => o.conversationScore - i.conversationScore || o.queryScore - i.queryScore || i.chunk.floor - o.chunk.floor || i.chunk.chunkIdx - o.chunk.chunkIdx),
			selected: []
		};
	}
	function Hr(t, e) {
		const n = /* @__PURE__ */ new Map();
		for (const r of t) {
			let i = 0;
			for (const o of r) if (e(o) && (n.set(o.chunk.chunkId, o), ++i >= le.shortlistPerSource)) break;
		}
		return [...n.values()];
	}
	async function Ca(t, e, n, r, i, o) {
		const a = (h) => !n.has(h.chunk.chunkId), u = (h) => a(h) && r(h);
		if (e === 0) {
			const h = t.temporalRows.find(u);
			if (h) return h;
		}
		const s = [...new Map([...Hr([t.conversationRows, t.lexicalRows], a), ...Hr([t.temporalRows], u)].map((h) => [h.chunk.chunkId, h])).values()];
		let c = null, l = -1 / 0;
		e > 0 && (o.maxMmrCandidates = Math.max(o.maxMmrCandidates, s.length));
		for (const [h, p] of s.entries()) {
			h % 32 === 0 && await i();
			const b = p.conversationScore;
			let f = 0;
			if (e > 0) for (const g of t.selected) f = Math.max(f, Ur(p.vector, g.vector)), o.mmrComparisons++;
			const d = le.lambda * b - (1 - le.lambda) * f;
			d > l && (c = p, l = d);
		}
		return c;
	}
	function Oa(t, e, n) {
		const r = [
			{
				items: e,
				limit: n
			},
			{
				items: t.filter((a) => a.evidenceLane === "floor"),
				limit: 1 / 0
			},
			{
				items: t.filter((a) => a.evidenceLane === "conversation"),
				limit: 1 / 0
			}
		].map((a) => ({
			...a,
			cursor: 0,
			emitted: 0
		})), i = /* @__PURE__ */ new Set(), o = [];
		for (; r.some((a) => a.cursor < a.items.length && a.emitted < a.limit);) for (const a of r) {
			let u = 0;
			for (; a.cursor < a.items.length && a.emitted < a.limit && u < le.admissionBatchSize;) {
				const s = a.items[a.cursor++];
				i.has(s.chunkId) || (i.add(s.chunkId), o.push(s), a.emitted++, u++);
			}
		}
		return o;
	}
	function qr(t, e, n) {
		return {
			...t.chunk,
			evidenceLane: e,
			queryScore: t.queryScore,
			lexicalScore: t.lexicalScore,
			_directEvidenceTemporalMatch: t.temporal,
			_directEvidenceTemporalCarrier: n,
			_directEvidencePassedMinScore: t.queryScore >= le.minSimilarity || t.lexicalScore > 0
		};
	}
	async function Pa(t, e, n = {}) {
		const r = Wr(n.queryVector), i = new Map((n.lexicalScores || []).map((_) => [_.chunkId, Number(_.score) || 0])), o = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Set(), u = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Map(), c = [], l = [], h = {
			parents: 0,
			floors: 0,
			sourceCandidates: 0,
			vectorHits: 0,
			missingVectors: 0,
			queryItems: 0,
			floorItems: 0,
			conversationItems: 0,
			lexicalItems: 0,
			temporalCandidates: 0,
			temporalFloorWinners: 0,
			temporalProtectedCandidates: 0,
			maxMmrCandidates: 0,
			mmrComparisons: 0
		}, p = () => {
			if (n.signal?.throwIfAborted(), n.isCurrent && !n.isCurrent()) throw new DOMException("Recall session released", "AbortError");
		};
		let b = performance.now();
		const f = async () => {
			performance.now() - b >= 8 && (await new Promise((_) => setTimeout(_, 0)), b = performance.now()), p();
		}, d = [];
		for (const _ of t || []) {
			p();
			const v = _?.event, C = Aa(v?.summary);
			!v?.id || u.has(v.id) || !C || C.end < C.start || (u.add(v.id), h.parents++, d.push(C));
		}
		const g = new Set((n.sourceTurns || []).flatMap((_) => [_.floor, _.contextFloor].filter(Number.isInteger)));
		let I = 0;
		for (const [_, v] of e.chunksByFloor) {
			if (await f(), Number.isInteger(n.hiddenThrough) && _ > n.hiddenThrough || !g.has(_) && !d.some((w) => _ >= w.start && _ <= w.end)) continue;
			const C = [];
			for (const w of v) {
				if (!String(w.text || "").trim()) continue;
				const R = Wr(e.chunkVectorsById.get(w.chunkId)?.vector), F = R && (!r || R.length === r.length) ? R : null;
				h[F ? "vectorHits" : "missingVectors"]++;
				const N = Ma(w, n.temporalCarrier);
				N && h.temporalCandidates++, C.push({
					chunk: w,
					vector: F,
					queryScore: Ur(r, F),
					lexicalScore: i.get(w.chunkId) || 0,
					temporal: N,
					conversationScore: 0
				}), ++I % 32 === 0 && await f();
			}
			o.set(_, C);
		}
		const m = [...o.values()].flat(), k = Ta(m);
		for (const _ of k.temporalRows) s.has(_.chunk.floor) || s.set(_.chunk.floor, _.chunk.chunkId);
		const x = (_) => ({
			queryRows: Ne(_.filter((v) => v.queryScore >= le.minSimilarity), (v) => v.queryScore),
			lexicalRows: Ne(_.filter((v) => v.lexicalScore > 0), (v) => v.lexicalScore),
			conversationRows: Ne(_.filter((v) => v.conversationScore > 0), (v) => v.conversationScore),
			temporalRows: k.temporalRows.filter((v) => _.includes(v)),
			selected: []
		}), S = /* @__PURE__ */ new Set();
		for (const _ of n.sourceTurns || []) S.has(_.floor) || (S.add(_.floor), l.push(x([...o.get(_.floor) || [], ...o.get(_.contextFloor) || []])));
		const T = [...o.values()].map(x).sort((_, v) => (v.conversationRows[0]?.conversationScore || 0) - (_.conversationRows[0]?.conversationScore || 0) || (v.queryRows[0]?.queryScore || 0) - (_.queryRows[0]?.queryScore || 0) || (_.queryRows[0]?.chunk.floor || 0) - (v.queryRows[0]?.chunk.floor || 0)), O = Ea(Math.max(h.parents, l.length) * le.perLane * 2, xa.maxCandidateShare), y = (_) => s.get(_.chunk.floor) === _.chunk.chunkId && h.temporalProtectedCandidates < O, A = (_, v) => {
			const C = y(_);
			C && h.temporalProtectedCandidates++, a.add(_.chunk.chunkId), c.push(qr(_, v, C));
		};
		for (const _ of l) {
			await f();
			const v = Ne([.../* @__PURE__ */ new Set([..._.queryRows, ..._.lexicalRows])], (C) => C.queryScore);
			for (const C of v.filter((w) => !a.has(w.chunk.chunkId)).slice(0, le.perLane)) A(C, "floor");
		}
		for (let _ = 0; _ < le.perLane; _++) for (const v of T) {
			const C = await Ca(v, _, a, y, f, h);
			C && (v.selected.push(C), A(C, "conversation"));
		}
		const M = new Map(c.map((_) => [_.chunkId, _])), E = Oa(c, k.queryRows.map((_) => ({
			...M.get(_.chunk.chunkId) || qr(_, "query", !1),
			evidenceLane: "query"
		})), o.size * le.perLane);
		return h.temporalFloorWinners = s.size, h.floors = o.size, h.sourceCandidates = m.length, h.queryItems = E.filter((_) => _.evidenceLane === "query").length, h.floorItems = E.filter((_) => _.evidenceLane === "floor").length, h.conversationItems = E.filter((_) => _.evidenceLane === "conversation").length, h.lexicalItems = E.filter((_) => _.lexicalScore > 0).length, h.candidates = h.relevantItems = E.length, p(), {
			items: E,
			stats: h,
			status: h.missingVectors ? "partial-vectors" : "applied"
		};
	}
	const Ra = 12e4;
	function qt(t) {
		return String(t || "") || null;
	}
	function Ba(t = {}) {
		const e = Math.max(1, Number(t.ttlMs || 12e4)), n = typeof t.now == "function" ? t.now : Date.now, r = typeof t.schedule == "function" ? t.schedule : setTimeout, i = typeof t.cancel == "function" ? t.cancel : clearTimeout, o = typeof t.onExpire == "function" ? t.onExpire : null, a = /* @__PURE__ */ new Map();
		function u(f, d, g) {
			const I = qt(f);
			if (!I || !d) return {
				released: !1,
				chatId: I,
				leaseId: d,
				activeSessions: 0
			};
			const m = a.get(I), k = m?.get(d);
			return k ? (m.delete(d), g && i(k.timer), m.size || a.delete(I), {
				released: !0,
				chatId: I,
				leaseId: d,
				startedAt: k.startedAt,
				expiresAt: k.expiresAt,
				activeSessions: m.size
			}) : {
				released: !1,
				chatId: I,
				leaseId: d,
				activeSessions: m?.size || 0
			};
		}
		function s(f, d, g = {}) {
			const I = qt(f);
			if (!I || !d) return null;
			u(I, d, !0);
			const m = Number(g.startedAt) || n(), k = Number(g.expiresAt) || m + e;
			let x = a.get(I);
			x || (x = /* @__PURE__ */ new Map(), a.set(I, x));
			const S = r(() => {
				const T = u(I, d, !1);
				if (T.released) try {
					o?.(T);
				} catch (O) {
					console.warn({
						source: self.location.href,
						operation: "timer"
					}, O);
				}
			}, Math.max(0, k - n()));
			return x.set(d, {
				startedAt: m,
				expiresAt: k,
				timer: S
			}), {
				chatId: I,
				leaseId: d,
				startedAt: m,
				expiresAt: k
			};
		}
		function c(f, d) {
			return u(f, d, !0);
		}
		function l(f, d) {
			const g = qt(f);
			return !!g && !!d && a.get(g)?.has(d);
		}
		function h(f) {
			const d = qt(f);
			return d && a.get(d)?.size || 0;
		}
		function p(f) {
			return h(f) > 0;
		}
		function b() {
			for (const f of a.values()) for (const d of f.values()) i(d.timer);
			a.clear();
		}
		return {
			add: s,
			release: c,
			hasLease: l,
			hasChat: p,
			count: h,
			clear: b
		};
	}
	const Gr = "recall-runtime-worker";
	function Fa() {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	}
	function Yr(t) {
		return String(t || "") || null;
	}
	function Ka(t) {
		try {
			return JSON.stringify(t);
		} catch {
			try {
				return String(t);
			} catch {
				return "[unstringifiable]";
			}
		}
	}
	function ye(t) {
		if (!t) return "none";
		const e = t.stats || t;
		return !e || typeof e != "object" ? Ka(e) : [
			`chat=${e.chatId || "-"}`,
			`status=${e.status || "-"}`,
			`ready=${e.ready ? 1 : 0}`,
			`warming=${e.warming ? 1 : 0}`,
			`meta=${e.meta ? 1 : 0}`,
			`floors=${e.chunkFloors ?? "-"}`,
			`chunks=${e.chunks ?? "-"}`,
			`l1v=${e.chunkVectors ?? "-"}`,
			`l2v=${e.eventVectors ?? "-"}`,
			`l0v=${e.stateVectors ?? "-"}`,
			`ver=${e.version ?? "-"}`,
			`err=${e.lastError || "-"}`
		].join(" ");
	}
	function Da(t = {}) {
		if (!t || typeof t != "object") return "unknown";
		const e = [`type=${t.type || "unknown"}`];
		return Number.isFinite(Number(t.floor)) && e.push(`floor=${Number(t.floor)}`), Array.isArray(t.items) && e.push(`items=${t.items.length}`), Array.isArray(t.chunks) && e.push(`chunks=${t.chunks.length}`), Array.isArray(t.eventIds) && e.push(`eventIds=${t.eventIds.length}`), t.domain && e.push(`domain=${t.domain}`), t.meta && typeof t.meta == "object" && e.push(`metaKeys=${Object.keys(t.meta).length}`), e.join(" ");
	}
	function se(t, e = "") {
		self.postMessage({
			type: "__log",
			payload: {
				level: "info",
				moduleId: Gr,
				message: `${t}${e ? ` ${e}` : ""}`
			}
		});
	}
	function et(t, e = "") {
		self.postMessage({
			type: "__log",
			payload: {
				level: "warn",
				moduleId: Gr,
				message: `${t}${e ? ` ${e}` : ""}`
			}
		});
	}
	function Qr(t) {
		return {
			chatId: t,
			meta: null,
			chunksByFloor: /* @__PURE__ */ new Map(),
			chunkVectorsById: /* @__PURE__ */ new Map(),
			eventVectorsById: /* @__PURE__ */ new Map(),
			stateVectorsById: /* @__PURE__ */ new Map(),
			ready: !1,
			warming: null,
			version: 0,
			status: "cold",
			lastError: null,
			refreshedAt: 0,
			timings: {}
		};
	}
	const X = /* @__PURE__ */ new Map(), de = Ba({
		ttlMs: Ra,
		onExpire({ chatId: t, leaseId: e, activeSessions: n }) {
			n || X.delete(t), et("session expired", `chat=${t} lease=${e} active=${n}`);
		}
	});
	function tt(t, e = {}) {
		return {
			backend: "worker",
			owner: "worker",
			chatId: String(t || ""),
			ready: !1,
			warming: !1,
			status: "session-cache idle",
			lastError: null,
			refreshedAt: 0,
			version: 0,
			meta: !1,
			chunkFloors: 0,
			chunks: 0,
			chunkVectors: 0,
			eventVectors: 0,
			stateVectors: 0,
			activeSessions: 0,
			timings: {},
			...e
		};
	}
	function Gt(t) {
		const e = String(t || "");
		if (!e) return null;
		let n = X.get(e);
		return n || (n = Qr(e), X.set(e, n), se("entry created", `chat=${e}`)), n;
	}
	function Va(t, e) {
		return {
			...t,
			chatId: e,
			floor: Number(t?.floor),
			chunkIdx: Number(t?.chunkIdx || 0)
		};
	}
	function Na(t) {
		const e = ce(t?.vector);
		return !t?.chunkId || !e?.length ? null : {
			chunkId: t.chunkId,
			vector: e,
			fingerprint: t.fingerprint
		};
	}
	function $a(t) {
		const e = ce(t?.vector);
		return !t?.eventId || !e?.length ? null : {
			eventId: t.eventId,
			vector: e,
			fingerprint: t.fingerprint
		};
	}
	function ja(t) {
		const e = ce(t?.vector);
		return !t?.atomId || !e?.length ? null : {
			atomId: t.atomId,
			floor: t.floor,
			vector: e,
			rVector: t.rVector ? ce(t.rVector) : null,
			fingerprint: t.fingerprint
		};
	}
	function Xr(t, e = []) {
		for (const n of e || []) {
			const r = Va(n, t.chatId);
			if (!Number.isInteger(r.floor) || !r.chunkId) continue;
			const i = (t.chunksByFloor.get(r.floor) || []).filter((o) => o.chunkId !== r.chunkId);
			i.push(r), i.sort((o, a) => (o.chunkIdx || 0) - (a.chunkIdx || 0)), t.chunksByFloor.set(r.floor, i);
		}
	}
	function Jr(t, e = []) {
		for (const n of e || []) {
			const r = Na(n);
			r && t.chunkVectorsById.set(r.chunkId, r);
		}
	}
	function Zr(t, e = []) {
		for (const n of e || []) {
			const r = $a(n);
			r && t.eventVectorsById.set(r.eventId, r);
		}
	}
	function ei(t, e = []) {
		for (const n of e || []) {
			const r = ja(n);
			r && t.stateVectorsById.set(r.atomId, r);
		}
	}
	function za(t, e = []) {
		const n = [];
		for (const r of e || []) {
			const i = t?.eventVectorsById.get(r);
			i && n.push({
				...i,
				vector: Uo(i.vector)
			});
		}
		return n;
	}
	function La(t, e) {
		for (const [n, r] of [...t.chunksByFloor.entries()]) if (!(n < e)) {
			for (const i of r) t.chunkVectorsById.delete(i.chunkId);
			t.chunksByFloor.delete(n);
		}
	}
	function Wa(t, e) {
		const n = t.chunksByFloor.get(e) || [];
		for (const r of n) t.chunkVectorsById.delete(r.chunkId);
		t.chunksByFloor.delete(e), t.meta?.lastChunkFloor >= e && (t.meta = {
			...t.meta,
			lastChunkFloor: e - 1
		});
	}
	function Ua(t, e) {
		for (const [n, r] of [...t.stateVectorsById.entries()]) Number(r.floor) >= e && t.stateVectorsById.delete(n);
	}
	function ti(t, e = "all") {
		(e === "all" || e === "chunks") && (t.chunksByFloor.clear(), t.chunkVectorsById.clear()), (e === "all" || e === "events") && t.eventVectorsById.clear(), (e === "all" || e === "state") && t.stateVectorsById.clear(), e === "all" && (t.meta = null, t.ready = !1, t.status = "cold");
	}
	function ee(t) {
		if (!t) return null;
		let e = 0;
		for (const n of t.chunksByFloor.values()) e += n.length;
		return {
			backend: "worker",
			owner: "worker",
			chatId: t.chatId,
			ready: t.ready,
			warming: !!t.warming,
			status: t.status,
			lastError: t.lastError,
			refreshedAt: t.refreshedAt,
			version: t.version,
			meta: !!t.meta,
			chunkFloors: t.chunksByFloor.size,
			chunks: e,
			chunkVectors: t.chunkVectorsById.size,
			eventVectors: t.eventVectorsById.size,
			stateVectors: t.stateVectorsById.size,
			activeSessions: de.count(t.chatId),
			timings: t.timings || {}
		};
	}
	async function Hn(t, e = "manual") {
		const n = Gt(t);
		if (!n) return null;
		if (n.warming) return se("refresh join in-flight", `chat=${n.chatId} reason=${e} before=${ye(ee(n))}`), n.warming;
		const r = n.version, i = ee(n);
		return n.status = "warming", n.lastError = null, se("refresh start", `chat=${n.chatId} reason=${e} before=${ye(i)}`), n.warming = (async () => {
			const o = performance.now(), [a, u, s, c, l] = await Promise.all([
				jo.get(n.chatId),
				zo.where("chatId").equals(n.chatId).toArray(),
				Dr.where("chatId").equals(n.chatId).toArray(),
				Lo.where("chatId").equals(n.chatId).toArray(),
				Wo.where("chatId").equals(n.chatId).toArray()
			]), h = Math.round(performance.now() - o);
			if (n.version !== r) {
				n.status = n.ready ? "ready" : "stale-refresh-skipped";
				const g = {
					ready: !1,
					stale: !0,
					reason: e,
					stats: ee(n)
				};
				return et("refresh stale", `chat=${n.chatId} reason=${e} startedVersion=${r} currentVersion=${n.version} after=${ye(g)}`), g;
			}
			const p = Qr(n.chatId);
			p.version = n.version;
			const b = performance.now();
			p.meta = a || null, Xr(p, u), Jr(p, s), Zr(p, c), ei(p, l);
			const f = Math.round(performance.now() - b);
			if (p.ready = !0, p.status = "ready", p.refreshedAt = Date.now(), p.timings = {
				...p.timings || {},
				loadFromDBMs: h,
				buildEntryMs: f
			}, !de.hasChat(n.chatId)) {
				const g = {
					ready: !1,
					stale: !0,
					expired: !0,
					reason: e,
					stats: tt(n.chatId)
				};
				return et("refresh discarded without active session", `chat=${n.chatId} reason=${e}`), g;
			}
			X.set(n.chatId, p);
			const d = {
				ready: !0,
				stale: !1,
				reason: e,
				stats: ee(p)
			};
			return se("refresh success", `chat=${n.chatId} reason=${e} after=${ye(d)}`), d;
		})().catch((o) => {
			throw n.status = "refresh failed", n.lastError = o?.message || String(o), et("refresh failed", `chat=${n.chatId} reason=${e} after=${ye(ee(n))}`), o;
		}).finally(() => {
			X.get(n.chatId) === n && (n.warming = null);
		}), n.warming;
	}
	async function Ee(t) {
		const e = Gt(t);
		if (!e) return null;
		if (e.ready) return e;
		se("ensureReady trigger refresh", `chat=${e.chatId} status=${e.status} ready=${e.ready ? 1 : 0}`);
		const n = await Hn(t, "ensure-ready");
		return n?.expired ? null : (n?.ready || (et("ensureReady retry", `chat=${e.chatId} first=${ye(n)}`), await Hn(t, "ensure-ready-retry")), Gt(t));
	}
	async function Ha(t, e = "recall") {
		const n = Yr(t);
		if (!n) return null;
		const r = performance.now(), i = Fa(), o = de.add(n, i);
		try {
			const a = await Ee(n);
			if (!de.hasLease(n, i)) throw new Error(`RecallRuntime session expired while loading: ${n}`);
			return a && (a.timings = {
				...a.timings || {},
				beginSessionTotalMs: Math.round(performance.now() - r)
			}), se("begin session", `chat=${n} lease=${i} reason=${e} active=${de.count(n)}`), {
				...o,
				ready: !!a?.ready,
				stats: ee(a)
			};
		} catch (a) {
			throw de.release(n, i).activeSessions || X.delete(n), a;
		}
	}
	function qa(t = {}) {
		const e = Yr(t.chatId), n = t.leaseId;
		if (!e || !n) return tt(e, { endSessionClearMs: 0 });
		const r = performance.now(), i = de.release(e, n);
		if (!i.released) return et("end session ignored", `chat=${e} lease=${n}`), X.has(e) ? ee(X.get(e)) : tt(e, { endSessionClearMs: 0 });
		if (!i.activeSessions) {
			X.delete(e);
			const a = Math.round(performance.now() - r);
			return se("end session cleared", `chat=${e} lease=${n} clear=${a}ms`), tt(e, { endSessionClearMs: a });
		}
		const o = X.get(e);
		return o && (o.timings = {
			...o.timings || {},
			endSessionClearMs: Math.round(performance.now() - r)
		}), se("end session retained", `chat=${e} lease=${n} active=${i.activeSessions}`), o ? ee(o) : tt(e);
	}
	function Ga(t, e = {}) {
		const n = X.get(String(t || ""));
		if (!n) return tt(t);
		const r = ee(n);
		switch (n.version++, e.type) {
			case "meta":
				n.meta = {
					...n.meta || { chatId: n.chatId },
					...e.meta || {}
				};
				break;
			case "upsertChunks":
				Xr(n, e.chunks || []);
				break;
			case "upsertChunkVectors":
				Jr(n, e.items || []);
				break;
			case "upsertEventVectors":
				Zr(n, e.items || []);
				break;
			case "upsertStateVectors":
				ei(n, e.items || []);
				break;
			case "deleteChunksFromFloor":
				La(n, Number(e.floor || 0));
				break;
			case "deleteChunksAtFloor":
				Wa(n, Number(e.floor || 0));
				break;
			case "deleteStateVectorsFromFloor":
				Ua(n, Number(e.floor || 0));
				break;
			case "deleteStateVectorsAtFloors":
				for (const [o, a] of n.stateVectorsById) e.floors.includes(a.floor) && n.stateVectorsById.delete(o);
				break;
			case "deleteEventVectorsByIds":
				for (const o of e.eventIds || []) n.eventVectorsById.delete(o);
				break;
			case "clear": ti(n, e.domain || "all");
		}
		n.ready && n.status !== "warming" && (n.status = "ready");
		const i = ee(n);
		return se("mutation applied", `chat=${n.chatId} ${Da(e)} before=${ye(r)} after=${ye(i)}`), i;
	}
	async function Ya(t, e = [], n) {
		const r = await Ee(t), i = performance.now(), o = (e || []).map(Number).filter(Number.isInteger), a = [], u = [];
		for (const l of o) a.push(...r?.chunksByFloor.get(l) || []);
		for (const l of a) {
			const h = r?.chunkVectorsById.get(l.chunkId);
			h && u.push(h);
		}
		const s = Go(a, u, n);
		s.stats.requestedFloors = o.length, s.stats.chunkCacheHits = o.length, s.stats.chunkCacheMisses = 0, s.stats.vectorCacheHits = s.stats.vectorHits, s.stats.vectorCacheMisses = s.stats.missingVectors, s.stats.cacheWarm = !0, s.stats.backend = "worker", s.stats.cacheOwner = "worker", s.stats.requestedL1Floors = o.length;
		const c = Math.round(performance.now() - i);
		return s.stats.runtimeScoreL1Ms = c, r && (r.timings = {
			...r.timings || {},
			scoreL1Ms: c
		}), s;
	}
	async function Qa(t, e = {}) {
		switch (t) {
			case "ping": return {
				pong: !0,
				backend: "worker"
			};
			case "beginSession": return await Ha(e.chatId, e.reason);
			case "endSession": return qa(e.lease);
			case "refresh": return await Hn(e.chatId, e.reason);
			case "applyMutation": return Ga(e.chatId, e.mutation);
			case "retainOnly": {
				const n = e.chatId ? String(e.chatId) : null;
				se("retainOnly request", `keep=${n || "*"}`);
				for (const r of [...X.keys()]) n && r === n || de.hasChat(r) || X.delete(r);
				return [...X.values()].map(ee);
			}
			case "clear":
				if (se("clear request", `chat=${e.chatId || "*"} domain=${e.domain || "all"}`), e.chatId) {
					const n = String(e.chatId || "");
					if (!de.hasChat(n)) {
						const r = Gt(e.chatId);
						ti(r, e.domain || "all"), se("clear result", ye(ee(r)));
					}
				} else {
					for (const n of [...X.keys()]) de.hasChat(n) || X.delete(n);
					se("clear result", "all entries removed");
				}
				return [...X.values()].map(ee);
			case "getMeta": return (await Ee(e.chatId))?.meta || null;
			case "getEventVectorsByIds": {
				const n = await Ee(e.chatId), r = performance.now(), i = za(n, e.eventIds || []), o = Math.round(performance.now() - r);
				return n && (n.timings = {
					...n.timings || {},
					getEventVectorsByIdsMs: o
				}), {
					records: i,
					stats: ee(n)
				};
			}
			case "scoreAnchors": {
				const n = await Ee(e.chatId), r = performance.now(), i = Ho([...n?.stateVectorsById.values() || []], e.queryVector);
				return n && (n.timings = {
					...n.timings || {},
					scoreAnchorsMs: Math.round(performance.now() - r)
				}), {
					scores: i,
					stats: ee(n)
				};
			}
			case "scoreEvents": {
				const n = await Ee(e.chatId), r = performance.now(), i = qo([...n?.eventVectorsById.values() || []], e.queryVector);
				return n && (n.timings = {
					...n.timings || {},
					scoreEventsMs: Math.round(performance.now() - r)
				}), {
					scores: i,
					stats: ee(n)
				};
			}
			case "selectL1Evidence": {
				const n = await Ee(e.chatId);
				return {
					selection: await Pa(e.parents, n, {
						...e.options,
						isCurrent: () => X.get(e.chatId) === n
					}),
					stats: ee(n)
				};
			}
			case "searchRaw": return await sa(e.chatId, e.documents, e.options);
			case "scoreL1": return await Ya(e.chatId, e.floors, e.queryVector);
			case "diffuseL0": {
				const n = await Ee(e.chatId), r = performance.now(), i = { diffusion: {} }, o = Ia(e.seeds || [], e.allAtoms || [], [...n?.stateVectorsById.values() || []], e.queryVector, i, { name1: e.name1 || "" });
				return n && (n.timings = {
					...n.timings || {},
					diffuseL0Ms: Math.round(performance.now() - r)
				}), {
					diffused: o,
					metrics: i.diffusion || {}
				};
			}
			case "stats": return [...X.values()].map(ee);
			default: throw new Error(`Unknown RecallRuntime worker request: ${t}`);
		}
	}
	self.onmessage = async (t) => {
		const { id: e, type: n, payload: r } = t.data || {};
		if (e) try {
			const i = await Qa(n, r || {});
			self.postMessage({
				id: e,
				ok: !0,
				result: i
			});
		} catch (i) {
			self.postMessage({
				id: e,
				ok: !1,
				error: i?.message || String(i)
			});
		}
	};
})();
