import fs from 'fs';
import path from 'path';
import pg from 'pg';
import format from 'pg-format';
import dotenv from 'dotenv';
import glob from 'glob';


export function handleBookmarks(app) {
    // app: Express
    //dotenv.config({path: '.database'})

    const schema = process.env.PG_SCHEMA;
    const table = 'bookmarks';

    const pool = new pg.Pool({
        user: process.env.PG_USERNAME,
        host: process.env.PG_HOST,
        database: process.env.PG_DATABASE,
        password: process.env.PG_PASSWORD,
        port: process.env.PG_PORT
    });

    function get_bookmarks(sql, req, res) {

        console.log(sql);
        pool.query(sql, (error, results) => {
            if (error) {
                console.log(error);
                return res.status(400).json({ error: 'Bad input parameters' });
            }

            if (results.rowCount == 0) {
                return res.status(404).json({ error: 'No record found' });
            }

            res.status(200).json(results.rows)
        });
    }

    app.get('/v1/bookmarks/id/:id', function(req, res) {
        let sql = format('SELECT * FROM %I.%I WHERE %I = %L', schema, table, 'id', req.params.id);
        get_bookmarks(sql, req, res);
    });

    app.get('/v1/bookmarks/user/:username/:status?', function(req, res) {
        let sql = format('SELECT * FROM %I.%I WHERE %I = %L', schema, table, 'username', req.params.username);
        if (req.params.status) {
            sql += format(' AND %I = %L', 'status', req.params.status);
        }
        get_bookmarks(sql, req, res);
    });

    app.get('/v1/bookmarks/pnu/:pnu/:status?', function(req, res) {
        let sql = format('SELECT * FROM %I.%I WHERE %I = %L', schema, table, 'pnu', req.params.pnu);
        if (req.params.status) {
            sql += format(' AND %I = %L', 'status', req.params.status);
        }
        get_bookmarks(sql, req, res);
    });

    app.get('/v1/bookmarks/shared-list/:username?', function(req, res) {
        let sql = format('SELECT * FROM %I.%I WHERE %I > %L', schema, table, 'status', 0);
        if (req.params.username) {
            sql += format(' AND %I = %L', 'username', req.params.username);
        }
        get_bookmarks(sql, req, res);
    });

    // get a thumbnail
    app.get('/v1/bookmarks/thumbnail/:id/:pnu', function(req, res) {
        let pnu = req.params.pnu;
        let imgName = 'thumbnail_' + req.params.id + '.png'
        let thumbnailPath = path.join('pnu-building', 'data', pnu.substr(0, 2), pnu, imgName);

        if (!fs.existsSync(thumbnailPath)) {
            return res.status(404).json({ error: 'Thumbnail not found' })
        }

        res.header("Content-Type", "image/png");
        res.sendFile(thumbnailPath, { root: global.__basedir });
    });

    // create a new bookmark
    app.post('/v1/bookmarks/user/:username', function(req, res) {

        console.log(req.body);

        let pnu = req.body['pnu'];

        if (pnu.length != 19) {
            console.log('Invalid pnu: ' + pnu);
            return res.status(400).json({ error: 'Invalid PNU: ' + pnu});
        }

        let sql = format('INSERT INTO %I.%I (', schema, table)
                + 'username, '
                + 'title, '
                + 'date_modified, '
                + 'address, '
                + 'site_area, '
                + 'pnu, '
                + 'status, '
                + 'camera_position, '
                + 'camera_rotation'
                + ') VALUES ('
                + format("%L, %L, %L, %L, %L, %L, %L, '{%s}', '{%s}'",
                    req.params.username,
                    req.body['title'],
                    new Date(),
                    req.body['address'],
                    req.body['siteArea'],
                    pnu,
                    (req.body['status'] ? req.body['status'] : 0),
                    req.body['cameraPosition'],
                    req.body['cameraRotation'])
                + format(') RETURNING %I', 'id');

        console.log(sql);

        pool.query(sql, (error, results) => {
            if (error) {
                console.log(error);
                return res.status(400).json(error);
            }

            if (results.rowCount == 0) {
                console.log('bookmark not created');
                return res.status(400).json({ error: 'bookmark not created' });
            }

            let bookmarkId = results.rows[0].id;
            console.log(`new bookmark id=${bookmarkId}`)

            let imgUrl = req.body['thumbnail'];
            let idx = (imgUrl && imgUrl.length > 0) ? imgUrl.indexOf(',') : -1;
            if (idx > -1) {

                let parts = imgUrl.split(',');
                let imgMeta = parts[0].replace('data:', '').split(';');
                let imgData = parts[1];

                let extension = (imgMeta.length > 0) ? imgMeta[0].replace('image/', '') : 'png';
                let encoding = (imgMeta.length > 1) ? imgMeta[1] : 'base64';

                let imgName = 'thumbnail_' + bookmarkId + '.' + extension;
                let dataDir = path.join('pnu-building', 'data', pnu.substr(0, 2), pnu);
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }
                let thumbnailPath = path.join(dataDir, imgName);
                fs.writeFile(thumbnailPath, imgData, encoding, (error) => {
                    if (error) console.log(error);
                });
            }
            res.status(201).json({bookmark_id: results.rows[0].id});
        });
    });

    // update a bookmark
    app.put('/v1/bookmarks/:id', function(req, res) {

        if (!req.params.id) {
            console.log('Invalid bookmark id');
            return res.status(400).json({ error: 'Invalid bookmark ID'});
        }

        let sql = format('UPDATE %I.%I SET', schema, table)
                + (req.body['username'] ? format(' %I = %L', 'username', req.body['username']) : '')
                + (req.body['title'] ? format(', %I = %L', 'title', req.body['title']) : '')
                + format(', %I = %L', 'date_modified', new Date())
                + (req.body['address'] ? format(', %I = %L', 'address', req.body['address']) : '')
                + (req.body['siteArea'] ? format(', %I = %L', 'site_area', req.body['siteArea']) : '')
                + (req.body['pnu'] ? format(', %I = %L', 'pnu', req.body['pnu']) : '')
                + (req.body['cameraPosition'] ? format(", %I = '{%s}'", 'camera_position', req.body['cameraPosition']) : '')
                + (req.body['cameraRotation'] ? format(", %I = '{%s}'", 'camera_rotation', req.body['cameraRotation']) : '')
                + (req.body['status'] ? format(', %I = %L', 'status', req.body['status']) : '')
                + format(' WHERE %I = %L', 'id', req.params.id)
                + format(' RETURNING %I', 'id');

        console.log(sql);

        pool.query(sql, (error, results) => {
            if (error) {
                console.log(error);
                return res.status(400).json({ error: error });
            }

            if (results.rowCount == 0) {
                console.log(`Bookmark ${req.params.id} not updated`);
                return res.status(404).json({ error: `Bookmark ${req.params.id} not updated`});
            }

            let bookmarkId = results.rows[0].id;
            console.log(`Updated bookmark id=${bookmarkId}`)

            let imgUrl = req.body['thumbnail'];
            let idx = (imgUrl && imgUrl.length > 0) ? imgUrl.indexOf(',') : -1;
            if (idx > -1) {
                let imgData = imgUrl.slice(idx + 1);
                let imgName = 'thumbnail_' + bookmarkId + '.png'
                let thumbnailPath = path.join('pnu-building', 'data', pnu.substr(0, 2), pnu, imgName);    
                fs.writeFile(thumbnailPath, imgData, 'base64', (error) => { if (error) console.log(error); });
            }
            res.status(200).json({bookmark_id: bookmarkId});
        });
    });

    // bookmark status 0: bookmarked-only, 1: bookmarked-and-shared, 2: shared-only
    app.put('/v1/bookmarks/:id/:status', function(req, res) {

        if (!req.params.id) {
            console.log('Invalid bookmark ID');
            return res.status(400).json({ error: 'Invalid bookmark ID'});
        }

        if (!req.params.status || req.params.status < 0 || req.params.status > 2) {
            console.log('Invalid bookmark status');
            return res.status(400).json({ error: 'Invalid bookmark status (valid status: 0, 1, 2)'});
        }

        var sql = format('UPDATE %I.%I SET', schema, table)
                + format(' %I = %L', 'status', req.params.status)
                + format(' WHERE %I = %L', 'id', req.params.id)
                + format(' RETURNING %I, %I', 'id', 'status');
        console.log(sql);

        pool.query(sql, (error, results) => {
            if (error) {
                console.log(error);
                return res.status(400).json({ error: error });
            }

            if (results.rowCount == 0) {
                console.log('Bookmark status not updated');
                return res.status(404).json({ error: 'Bookmark status not updated'})
            }

            res.status(200).json({ id: results.rows[0].id, status: results.rows[0].status });
        });
    });

    // delete a bookmark
    app.delete('/v1/bookmarks/:id', function(req, res, next) {

        if (!req.params.id || req.params.id < 0) {
            console.log('invalid bookmark id');
            return res.status(404).json({ error: 'Invalid bookmark ID'});
        }

        var sql = format('DELETE FROM %I.%I WHERE %I = %L RETURNING %I, %I', schema, table, 'id', req.params.id, 'id', 'pnu');

        console.log(sql);

        pool.query(sql, (error, results) => {
            if (error) {
                console.log(error);
                return res.status(400).json({ error: error });
            }

            if (results.rowCount == 0) {
                console.log('Failed to delete or id does not exist');
                return res.status(404).json({ error: 'Failed to delete or id does not exist' });
            }

            let bookmarkId = results.rows[0].id;
            let pnu = results.rows[0].pnu;
            console.log(`deleted bookmark id=${bookmarkId}, pnu=${pnu}`)

            if (bookmarkId == req.params.id) {
                let thumbnailName = 'thumbnail_' + bookmarkId + '.*';
                let thumbnailPath = path.join('pnu-building', 'data', pnu.substr(0, 2), pnu, thumbnailName);
                let thumbnails = glob.sync(thumbnailPath);
                for (const file of thumbnails) {
                    fs.rm(file, (error) => { if (error) console.log(error); });
                }
            }
            res.status(200).json({bookmark_id: results.rows[0].id});
        });
    });
    
}
