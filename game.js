const log = console.log;

const canvas = document.createElement("canvas")
canvas.width = 500;
canvas.height = 400;
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

muted = false;
unitTesting = false;
masterVolume = .25;

const image_names = [
    "t_i",
    "rock_1",
    "particle_circle",
    "particle_block",
];

let images = [];
for(var i=0; i< image_names.length; i++) {
	var image = new Image();

	image.src = image_names[i]+".png";
	images[image_names[i]]=image;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const TAU = Math.PI * 2;
const rng = new RNG(String(new Date()));

function vec_sub(a, b) {
    return [
        a[0] - b[0],
        a[1] - b[1]
    ];
}

function vec_add(a, b) {
    return [
        a[0] + b[0],
        a[1] + b[1]
    ];
}

function do_lines_intersect(
    a_start, a_end,
    b_start, b_end
) {
    const delta = vec_sub(a_start, b_start);

    const mat = [
        a_end[0] - a_start[0], b_end[0] - b_start[0],
        a_end[1] - a_start[1], b_end[1] - b_start[1],
    ];

    const det = mat[0] * mat[3] - mat[1] * mat[2];

    const epsi = 1/(1024*16);

    if(Math.abs(det) < epsi) {
        return false;
    }

    const inv_det = 1/det;

    const inverse = [
        mat[3] * inv_det, -mat[1] * inv_det,
        -mat[2] * inv_det, mat[0] * inv_det
    ];

    const weights = [
        inverse[0] * delta[0] + inverse[1] * delta[1],
        inverse[2] * delta[0] + inverse[3] * delta[1]
    ];

    return weights;
}

function dot(a, b) {
    return a[0] * b[0] + b[1] * a[1];
}

function vec_len(a) {
    return Math.sqrt(dot(a,a));
}

function atan2(y,x) {
    let ret = Math.atan2(y,x);

    if(ret < 0) {
        ret += TAU;
    }

    return ret;
}

function vec_normalize(a) {
    const len = vec_len(a);
    const epsi = 1/(1024*16);

    if(Math.abs(len) < epsi) {
        return [0, 0];
    }

    return [a[0] / len, a[1] / len];
}

function vec_copy(a) {
    return [a[0], a[1]];
}

function vec_lerp(a, t, b) {
    return [
        (b[0] - a[0]) * t + a[0],
        (b[1] - a[1]) * t + a[1]
    ];
}

function is_point_in_circle(
        point,
        origin,
        radius
) {
    const origin_to_point = [
        point[0] - origin[0],
        point[1] - origin[1]
    ];

    const otp_length_sq = dot(origin_to_point, origin_to_point);

    radius *= radius;

    if(otp_length_sq > radius) {
        return false;
    }

    return true;
}

function is_point_in_rect(
        point,
        rect
) {
    let x_ok = point[0] > rect[0] && (rect[0] + rect[2]) > point[0];
    let y_ok = point[1] > rect[1] && (rect[1] + rect[3]) > point[1];

    return x_ok && y_ok;
}


function sign(x) {
    if(x >= 0) return 1;
    return -1;
}

function clamp(v, min, max) {
    if(min > v) return min;
    if(v > max) return max;
    return v;
}

let shake_cam_x = {time_seconds: 0};
let shake_cam_y = {time_seconds: 0};

function update_axis_shake(
    shake,
    dt
) {
    if(shake.time_seconds <= 0) {
        shake.output_sample = 0;
        return;
    }

    shake.time_seconds -= dt;
    const sample_index = Math.floor(shake.time_seconds / shake.samples_per_second);

    let sample = 0;
    if(shake.prev_shake_sample_index == sample_index) {
        sample = shake.prev_sample;
    }
    else {
        sample = rng.uniform() * 2.0 - 1.0;
    }

    shake.prev_shake_sample_index = sample_index;
    shake.prev_sample = sample;

    let amplitude_t = shake.time_seconds / shake.time_max;
    shake.output_sample = sample * shake.amplitude * amplitude_t;
}

function do_camera_shake(amp) {
    const do_shake_for = (shake) => {
        if(shake.time_seconds > 0) {
            shake.time_seconds += shake.time_max * .5;
            shake.time_seconds = clamp(shake.time_seconds, 0, shake.time_max);
            shake.amplitude += amp * .25;
            shake.prev_shake_sample_index = -1;
        }
        else {
            shake.time_seconds = 1;
            shake.time_max = 1;
            shake.samples_per_second = .01;
            shake.prev_shake_sample_index = -1;
            shake.amplitude = amp;
        }
    };

    do_shake_for(shake_cam_x);
    do_shake_for(shake_cam_y);
}

function smoothstep(x) {
    return x * x * (3.0 - 2.0 * x);
}

function bounce_out(t) {
  const a = 4.0 / 11.0;
  const b = 8.0 / 11.0;
  const c = 9.0 / 10.0;

  const ca = 4356.0 / 361.0;
  const cb = 35442.0 / 1805.0;
  const cc = 16061.0 / 1805.0;

  const t2 = t * t;

  return t < a
    ? 7.5625 * t2
    : t < b
      ? 9.075 * t2 - 9.9 * t + 3.4
      : t < c
        ? ca * t2 - cb * t + cc
        : 10.8 * t * t - 20.52 * t + 10.72;
}

let prev_time = 0;

const KEY_LEFT = 0;
const KEY_RIGHT = 1;
const keys = {};
let mouse_world_no_cam = [];
let paused = true;

let pad = {
    rect: [0, -canvas.height * .5 + 5, 100, 20],
    vel: [0, 0],
    prev_pos: [0, 0],
    rotation: 0,
}
pad.rect[0] = - canvas.height * .5 + pad.rect[2] * .5;

let blocks = [];
let destroyed_blocks = 0;

const wall_thickness = 10;
const walls = [
    {
        rect: [-canvas.width * .5, -canvas.height * .5 - 10, canvas.width, wall_thickness],
        deadly: true,
    },
    {
        rect: [-canvas.width * .5, canvas.height * .5 - wall_thickness, canvas.width, wall_thickness],
    },
    {
        rect: [-canvas.width * .5, -canvas.height * .5 - wall_thickness, wall_thickness, canvas.height],
    },
    {
        rect: [canvas.width * .5 - wall_thickness, -canvas.height * .5, wall_thickness, canvas.height],
    }
];

function init_bullet() {
    bullet = [];

    bullet.push({
        rect: [0, 0, 10, 10],
        vel: [-200, -200],
        prev_rects: [],

        destroys_this_bounce: 0,
        rotation: 0,

        tween_active: false,
        tween_t: 0,
        tween_ext: [0, 0],
    });
};

const TWEEN_LINEAR = 0;
const TWEEN_SMOOTHSTEP = 1;
const TWEEN_BOUNCE = 2;

function do_collide_tween(b, mag, type) {
    b.tween_t = 0;
    b.tween_active = true;
    b.tween_type = type;
    b.tween_ext = [
        b.rect[2] * mag,
        b.rect[3] * mag,
    ];
}

function get_tweened_rect(b) {
    let pos_x = b.rect[0];
    let pos_y = b.rect[1];
    let ext_x = b.rect[2];
    let ext_y = b.rect[3];

    if(b.tween_active) {
        let t = 1 - b.tween_t;
        if(b.tween_type == TWEEN_SMOOTHSTEP) {
            t = smoothstep(t);
        }
        else if(b.tween_type == TWEEN_BOUNCE) {
            t = bounce_out(t);
        }

        ext_x += b.tween_ext[0] * t;
        ext_y += b.tween_ext[1] * t;

        pos_x -= b.tween_ext[0] * t * .5;
        pos_y -= b.tween_ext[1] * t * .5;
    }

    return [pos_x, pos_y, ext_x, ext_y];
}

function update_tween(b, dt) {
    if(b.tween_active) {
        b.tween_t += dt;

        if(b.tween_t >= 1) {
            b.tween_active = false;
        }
    }
}

function spawn_blocks() {

    const count = [7, 5];
    const pad = [5, 5];
    const size = [50, 20];

    const start_cursor = [
        -canvas.width * .5 + pad[0] + 55,
        15,
    ];

    const cursor = vec_copy(start_cursor);

    for(let y = 0; y < count[1]; y += 1) {
        for(let x = 0; x < count[0]; x += 1) {
            let p = {
                rect: [cursor[0], cursor[1], size[0], size[1]],
                vel: [0, 0],
            };

            cursor[0] += size[0] + pad[0];

            blocks.push(p);
        }

        cursor[0] = start_cursor[0];
        cursor[1] += size[1] + pad[1];
    }
}


function init_blocks() {
    blocks = [];
    destroyed_blocks = 0;
    spawn_blocks();
}

function update(time) {
    let dt = (time - prev_time) / 1000;
    prev_time = time;

    if(!paused) {
        for(const w of walls) {
            update_tween(w, dt);
        }

        pad.rect[0] = mouse_world_no_cam[0] - pad.rect[2] * .5;
        pad.rect[1] = -canvas.height * .5 + 5;

        if(-canvas.width * .5 > pad.rect[0]) {
            pad.rect[0] = -canvas.width * .5;
        }
        else if(canvas.width * .5 < pad.rect[0] + pad.rect[2]) {
            pad.rect[0] = canvas.width * .5 - pad.rect[2];
        }

        pad.vel[0] = pad.rect[0] - pad.prev_pos[0];
        pad.vel[1] = pad.rect[1] - pad.prev_pos[1];

        for(const b of bullet) {
            const prev_pos = [b.rect[0], b.rect[1]];
            const vellen = vec_len(b.vel);
            const max = (vellen / 200) * 10;

            if(b.vel[1] < 0 && vec_len(b.vel)> 500 && b.rect[1] < -100) {
                dt *= .2;
            }

            b.rotation += (vellen) * DEG_TO_RAD * dt;

            if(b.prev_rects.length > max) {
                b.prev_rects.splice(max - 1);
            }

            update_tween(b, dt);

            b.prev_rects.unshift([b.rect[0], b.rect[1], b.rect[2], b.rect[3]]);

            b.rect[0] += b.vel[0] * dt;
            b.rect[1] += b.vel[1] * dt;

            const collide_with = (b, oth) => {
                let coll_point = [
                    b.rect[0] + b.rect[2] * .5,
                    b.rect[1] + b.rect[3] * .5
                ];

                const coll_rect = [
                    oth.rect[0] - b.rect[2] * .5,
                    oth.rect[1] - b.rect[3] * .5,
                    oth.rect[2] + b.rect[2],
                    oth.rect[3] + b.rect[3],
                ];

                if(is_point_in_rect(coll_point, coll_rect)) {

                    {
                        coll_point[0] = prev_pos[0] + b.rect[2] * .5;
                        coll_point[1] = prev_pos[1] + b.rect[3] * .5;

                        // NOTE(justas): search in t for resolved collision position.
                        // ideally the number of iterations would
                        // be somehow proportional to the delta time and the velocity
                        // of our collider
                        let iter_count = 10;
                        for(let iter = 0; 
                                iter < iter_count; 
                                iter += 1
                        ) {
                            const t = (iter / (iter_count - 1));

                            const new_coll_point = vec_lerp(prev_pos, t, [b.rect[0], b.rect[1]]);

                            if(is_point_in_rect(new_coll_point, coll_rect)) {
                                break;
                            }

                            coll_point = new_coll_point;
                        }

                        b.rect[0] = coll_point[0] - b.rect[2] * .5;
                        b.rect[1] = coll_point[1] - b.rect[3] * .5;
                    }

                    const other_verts = [
                        [oth.rect[0] + oth.rect[2], oth.rect[1]],
                        [oth.rect[0] + oth.rect[2], oth.rect[1] + oth.rect[3]],
                        [oth.rect[0],               oth.rect[1] + oth.rect[3]],
                        [oth.rect[0],               oth.rect[1]],
                    ];

                    const other_center = [
                        oth.rect[0] + oth.rect[2] * .5,
                        oth.rect[1] + oth.rect[3] * .5,
                    ];

                    const other_normals = [
                        [-1, 0],
                        [0, 1],
                        [1, 0],
                        [0, -1],
                    ];

                    const calc_angle = (center, vert) => {
                        const normal = vec_sub(vert, center);
                        const angle = atan2(normal[1], normal[0]);
                        return angle;
                    };

                    let our_angle = calc_angle(
                        other_center,
                        [
                            b.rect[0] + b.rect[2] * .5,
                            b.rect[1] + b.rect[3] * .5,
                        ]
                    );

                    let normal = [0,0];
                    let has_normal = false;

                    for(let vert_idx = 0;
                            vert_idx < other_verts.length;
                            vert_idx += 1
                    ) {
                        const v1 = other_verts[vert_idx];
                        const v2 = other_verts[(vert_idx + 1) % other_verts.length];

                        const from = calc_angle(other_center, v1);
                        const to = calc_angle(other_center, v2);

                        if(from > to) {
                            if(our_angle >= from || to >= our_angle) {
                                has_normal = true;
                            }
                        }
                        else {
                            if(our_angle >= from && to >= our_angle) {
                                has_normal = true;
                            }
                        }

                        if(has_normal) {
                            normal = other_normals[vert_idx];
                            break;
                        }
                    }

                    const d = dot(b.vel, normal);
                    b.vel[0] = b.vel[0] - (2 * d * normal[0]);
                    b.vel[1] = b.vel[1] - (2 * d * normal[1]);

                    return normal;
                }

                return null;
            }

            const prev_vel = [b.vel[0], b.vel[1]];
            for(let i = 0 ; 
                    i < blocks.length; 
            ) {
                if(blocks[i].is_dead) {
                    i += 1;
                    continue;
                }

                let normal = collide_with(b, blocks[i]);

                if(normal) {
                    do_collide_tween(b, 2, TWEEN_BOUNCE);

                    blocks[i].vel = [-prev_vel[0], -prev_vel[1]];
                    blocks[i].is_dead = true;
                    blocks[i].dead_for = 0.0;

                    let vel = vec_normalize(b.vel);
                    let len = vec_len(b.vel) + 40;
                    len = clamp(len, 0, 800);

                    b.vel[0] = vel[0] * len;
                    b.vel[1] = vel[1] * len;

                    do_camera_shake(2);
                    destroyed_blocks += 1;

                    if(rng.uniform() > .7) {
                        playSound(22407302);
                    }
                    else if(rng.uniform() > .4) {
                        playSound(8174102);
                    }
                    else {
                        playSound(17325302);
                    }

                    if(b.destroys_this_bounce == 0) {
                        playSound(73547900);
                    }
                    else if(b.destroys_this_bounce == 1) {
                        playSound(83266300);
                    }
                    else if(b.destroys_this_bounce == 2) {
                        playSound(15160700);
                    }
                    else {
                        playSound(30069100);
                    }

                    b.destroys_this_bounce += 1;
                }
                else {
                    i += 1;
                }
            }


            {
                    const slowmo = vec_len(b.vel)> 500;
                let normal = collide_with(b, pad);
                if(normal) {

                    let vel = vec_normalize(b.vel);
                    let len = vec_len(pad.vel);

                    do_collide_tween(pad, .2, TWEEN_SMOOTHSTEP);

                    b.vel[0] = vel[0] * ((len * 10) + 200);
                    b.vel[1] = vel[1] * ((len * 10) + 200);

                    // NOTE(justas): in case we ever get stuck
                    b.rect[0] += normal[0] * .1;
                    b.rect[1] += normal[1] * .1;

                    do_collide_tween(b, 1, TWEEN_LINEAR);

                    b.destroys_this_bounce = 0;


                    if(slowmo) {
                        playSound(6853103);
                    }
                    else {
                        playSound(58526503);
                    }
                }
            }

            for(const wall of walls) {
                let normal = collide_with(b, wall);

                if(wall.is_dead) {
                    continue;
                }

                if(normal) {
                    do_collide_tween(b, 2, TWEEN_SMOOTHSTEP);

                    if(wall.deadly) {
                        init_blocks();
                        init_bullet();
                        playSound(83552302);
                    }
                    else {
                        do_collide_tween(wall, 1, TWEEN_LINEAR);

                        if(rng.uniform() > .5) {
                            playSound(8223507);
                        }
                        else {
                            playSound(5448907);
                        }
                    }
                }
            }
        }

        pad.prev_pos[0] = pad.rect[0];
        pad.prev_pos[1] = pad.rect[1];
    }

    {
        let sat = clamp(13 + destroyed_blocks / 3, 0, 60);
        let light = clamp(46 + destroyed_blocks / 7, 0, 80);
        
        ctx.fillStyle = `hsl(${(10 - (destroyed_blocks * 3)) % 360}, ${sat}%, ${light}%)`;
    }
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(1, -1);
    ctx.translate(canvas.width * .5, -canvas.height * .5);

    update_axis_shake(shake_cam_x, dt);
    update_axis_shake(shake_cam_y, dt);

    ctx.translate(shake_cam_x.output_sample, shake_cam_y.output_sample);

    const blit_blob= (style, x, y, sx, sy, r) => {

        ctx.save();

        ctx.translate(x, y);

        if(r != 0) {
            ctx.translate(sx * .5, sy * .5);
            ctx.rotate(r);
            ctx.translate(-sx * .5, -sy * .5);
        }

        ctx.fillStyle = style;
        ctx.fillRect(0, 0, sx, sy);

        ctx.restore();
    };

    for(const b of bullet) {
        ctx.beginPath();
        let x = b.rect[0] + b.rect[2] * .5;
        let y =  b.rect[1] + b.rect[3] * .5;
        let len = vec_len(b.vel);

        ctx.beginPath();
        ctx.arc(x, y, len * len / 9000, 0, 2 * Math.PI);

        ctx.fillStyle = `hsla(${(87 - (len / 10)) % 360 }, 42%, 67%, .5)`;
        ctx.fill();

        if(vec_len(b.vel) > 500) {
            ctx.strokeStyle= `hsla(${(200 - (len / 10)) % 360 }, 42%, 67%, 1)`;
            ctx.stroke();
        }

        ctx.closePath();
    }

    const debug_circle = (px, py, t, col) => {
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.arc(px, py, t, 0, Math.PI * 2);
        ctx.stroke();
    }

    {
        let rect = get_tweened_rect(pad);

        let hue_off = 0;
        update_tween(pad, dt);

        if(pad.tween_active) {
            hue_off = (1 - pad.tween_t) * 50;
        }

        blit_blob(`hsl(${(183+ hue_off) % 360}, 61%, 72%`,
            rect[0], rect[1],
            rect[2], rect[3],
        );
    }

    {
        let i = blocks.length - 1;
        while(i >= 0) {
            const p = blocks[i];

            p.rect[0] += p.vel[0] * dt;
            p.rect[1] += p.vel[1] * dt;

            let hue_off = 0;
            let alpha = 1;

            if(p.is_dead) {
                p.vel[1] -= 500 * dt;

                p.dead_for += dt;
                alpha = 1 - p.dead_for;
                alpha *= alpha;
                hue_off = p.dead_for * 50;

                if(p.dead_for >= 1) {
                    blocks.splice(i, 1);
                }
            }

            blit_blob(`hsla(${37 + hue_off}, 100%, 50%, ${alpha})`,
                p.rect[0], p.rect[1],
                p.rect[2], p.rect[3]
            );

            i--;
        }

        if(blocks.length <= 0) {
            spawn_blocks();
        }
    }

    for(const b of bullet) {

        let rect = get_tweened_rect(b);

        for(let i = 0;
                i < b.prev_rects.length;
                i += 1
        ) {
            const prev = b.prev_rects[i];
            let t = 1 - (i / (b.prev_rects.length - 1));
            t = smoothstep(t);

            blit_blob(`hsla(${(120 - (i * 8)) % 360}, 67%, 52%, ${t * .4})`,
                prev[0], prev[1],
                prev[2], prev[3],
            );
        }

        blit_blob("lime", 
            rect[0], rect[1],
            rect[2], rect[3],
            b.rotation
        );
    }

    for(const b of walls) {
        let rect = get_tweened_rect(b);

        let hue_off = 0;
        if(b.tween_active) {
            hue_off = (1 - b.tween_t) * 50;
        }

        blit_blob(`hsl(${(183+ hue_off) % 360}, 61%, 72%`,
            rect[0], rect[1],
            rect[2], rect[3],
        );
    }

    ctx.restore();

    if(paused) {
        ctx.fillStyle = "rgba(32, 32, 32, .8)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.beginPath();
        ctx.moveTo(canvas.width * .25, canvas.height * .25);
        ctx.lineTo(canvas.width * .75, canvas.height * .5);
        ctx.lineTo(canvas.width * .25, canvas.height * .75);
        ctx.lineTo(canvas.width * .25, canvas.height * .25);
        ctx.fillStyle = "whitesmoke";
        ctx.fill();
        ctx.closePath();
        document.body.style.cursor = "pointer";
    }
    else {
        document.body.style.cursor = "";
    }

    requestAnimationFrame(update);
}

function get_mouse_pos(e) {
	var rect = e.target.getBoundingClientRect();
	var scaleX = e.target.width / rect.width;    // relationship bitmap vs. element for X
	var scaleY = e.target.height / rect.height;  // relationship bitmap vs. element for Y

	var clientX=e.clientX;
	var clientY=e.clientY;

	if (scaleX < scaleY){
		scaleX=scaleY;
		clientX-=rect.width/2-(e.target.width/scaleX)/2;
	} else {
		scaleY=scaleX;
		clientY-=rect.height/2-(e.target.height/scaleY)/2;
	}
	var x = (clientX - rect.left) * scaleX;   // scale mouse coordinates after they have
	var y =(clientY - rect.top) * scaleY     // been adjusted to be relative to element

    return [x,y];
}

function on_pointer_move(e) {
    const pos = get_mouse_pos(e);

    pos[1] *= -1;

    pos[0] -= canvas.width * .5;
    pos[1] += canvas.height * .5;

    mouse_world_no_cam = pos;
}

function update_key(e, state) {
    let ret = true;
    if(e.key == "ArrowLeft" || e.key == "a" || e.key == "A") {
        keys[KEY_LEFT] = state;
        e.preventDefault();
        ret = false;
    }
    else if(e.key == "ArrowRight" || e.key == "d" || e.key == "D") {
        keys[KEY_RIGHT] = state;
        e.preventDefault();
        ret = false;
    }

    return ret;
}

function keyup(e) {
    update_key(e, false);
}

function keydown(e) {
    update_key(e, true);
}

function on_pointer_up(e) {
    paused = !paused;
}

document.body.addEventListener("keyup",keyup);
document.body.addEventListener("keydown",keydown);
document.body.addEventListener("pointermove",on_pointer_move);
document.body.addEventListener("pointerup",on_pointer_up);

init_blocks();
init_bullet();
requestAnimationFrame(update);
