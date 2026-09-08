import type { Snippet } from "./snippets";

/**
 * Bộ snippet ship sẵn.
 *
 * **Hằng số trong code, không đi qua store.** Hệ quả đúng theo cả hai chiều: nâng bản MixDB thì bộ
 * này được cập nhật theo, và thứ người dùng tự viết thì không bao giờ bị một bản nâng cấp ghi đè.
 *
 * Snippet sẵn có không sửa và không xoá được. Muốn một bản khác thì thêm một snippet của mình —
 * đơn giản hơn hẳn việc dựng khái niệm "bản sẵn có đã bị sửa", thứ phải trả lời câu hỏi "bản nâng
 * cấp đổi snippet này thì sao" mà không có câu trả lời nào dễ chịu.
 *
 * Mỗi mục phải qua được tiêu chí nhận tool của module: nằm trên đường đi của một dev đang làm việc
 * với DB, API hoặc server. Ngoặc đặt sẵn ở nơi cần — `-p'{{password}}'` — vì `fill` cố ý không bọc
 * hộ.
 */
export const BUILTIN: Snippet[] = [
  {
    id: "b-mysqldump",
    title: "mysqldump",
    group: "mysql",
    template:
      "mysqldump -h {{host}} -P {{port}} -u {{user}} -p'{{password}}' {{database}} > {{file}}.sql",
  },
  {
    id: "b-mysql-restore",
    title: "mysql restore",
    group: "mysql",
    template:
      "mysql -h {{host}} -P {{port}} -u {{user}} -p'{{password}}' {{database}} < {{file}}.sql",
  },
  {
    id: "b-pgdump",
    title: "pg_dump",
    group: "postgres",
    template: "pg_dump -h {{host}} -p {{port}} -U {{user}} -Fc {{database}} > {{file}}.dump",
  },
  {
    id: "b-pgrestore",
    title: "pg_restore",
    group: "postgres",
    template:
      "pg_restore -h {{host}} -p {{port}} -U {{user}} -d {{database}} --clean --if-exists {{file}}.dump",
  },
  {
    id: "b-psql",
    title: "psql",
    group: "postgres",
    template: "psql -h {{host}} -p {{port}} -U {{user}} -d {{database}}",
  },
  {
    id: "b-mongodump",
    title: "mongodump",
    group: "mongo",
    template: "mongodump --uri='{{uri}}' --db={{database}} --out={{dir}}",
  },
  {
    id: "b-mongorestore",
    title: "mongorestore",
    group: "mongo",
    template: "mongorestore --uri='{{uri}}' --db={{database}} {{dir}}/{{database}}",
  },
  {
    id: "b-redis-cli",
    title: "redis-cli",
    group: "redis",
    template: "redis-cli -h {{host}} -p {{port}} -a '{{password}}' -n {{db}}",
  },
  {
    id: "b-docker-mysql",
    title: "docker run mysql",
    group: "docker",
    template:
      "docker run -d --name {{name}} -e MYSQL_ROOT_PASSWORD='{{password}}' -p {{port}}:3306 mysql:8",
  },
  {
    id: "b-docker-postgres",
    title: "docker run postgres",
    group: "docker",
    template:
      "docker run -d --name {{name}} -e POSTGRES_PASSWORD='{{password}}' -p {{port}}:5432 postgres:16",
  },
  {
    id: "b-docker-logs",
    title: "docker logs",
    group: "docker",
    template: "docker logs -f --tail 200 {{container}}",
  },
  {
    id: "b-docker-prune",
    title: "docker system prune",
    group: "docker",
    template: "docker system prune -af --volumes",
  },
  {
    id: "b-systemctl",
    title: "systemctl status",
    group: "server",
    template: "systemctl status {{service}}",
  },
  {
    id: "b-journalctl",
    title: "journalctl",
    group: "server",
    template: "journalctl -u {{service}} -n 200 --no-pager",
  },
  {
    id: "b-ssh-tunnel",
    title: "SSH tunnel",
    group: "ssh",
    template: "ssh -N -L {{local_port}}:{{remote_host}}:{{remote_port}} {{user}}@{{server}}",
  },
  {
    id: "b-scp",
    title: "scp",
    group: "ssh",
    template: "scp {{user}}@{{server}}:{{remote_path}} {{local_path}}",
  },
];
